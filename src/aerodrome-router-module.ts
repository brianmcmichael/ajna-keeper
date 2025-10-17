// src/aerodrome-router-module.ts
// AERODROME INTEGRATION: Swap module for Aerodrome Finance on Base network
// Aerodrome is a V2-style DEX (fork of Velodrome) with both stable and volatile pools

import { Contract, BigNumber, Signer, providers, ethers } from 'ethers';
import { logger } from './logging';
import { NonceTracker } from './nonce';
import { weiToDecimaled } from './utils';
import { getTokenFromAddress } from './uniswap';

// ABIs
const ERC20_ABI = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

// Aerodrome Router ABI - V2 style with route structs
const AERODROME_ROUTER_ABI = [
  // Route struct: (address from, address to, bool stable, address factory)
  `function swapExactTokensForTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    (address from, address to, bool stable, address factory)[] calldata routes,
    address to,
    uint256 deadline
  ) external returns (uint256[] memory amounts)`,
  `function getAmountsOut(
    uint256 amountIn,
    (address from, address to, bool stable, address factory)[] memory routes
  ) external view returns (uint256[] memory amounts)`,
  'function defaultFactory() external view returns (address)',
];

const AERODROME_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)',
  'function isPair(address pool) external view returns (bool)',
];

// Route structure for Aerodrome
interface Route {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
}

/**
 * Swaps tokens using Aerodrome Router - V2-style DEX on Base network
 * Supports both stable and volatile pools
 */
export async function swapWithAerodromeRouter(
  signer: Signer,
  tokenAddress: string,
  amount: BigNumber,
  targetTokenAddress: string,
  slippagePercentage: number,
  routerAddress: string,
  factoryAddress: string,
  poolType?: 'stable' | 'volatile'
) {

  // Validation
  if (!routerAddress) {
    throw new Error('Aerodrome Router address must be provided via configuration');
  }
  if (!factoryAddress) {
    throw new Error('Aerodrome Factory address must be provided via configuration');
  }
  if (slippagePercentage === undefined) {
    throw new Error('Slippage must be provided via configuration');
  }
  if (!signer || !tokenAddress || !amount) {
    throw new Error('Invalid parameters provided to swap');
  }

  const provider = signer.provider;
  if (!provider) {
    throw new Error('No provider available, skipping swap');
  }

  const network = await provider.getNetwork();
  const chainId = network.chainId;
  const signerAddress = await signer.getAddress();

  logger.info(`Chain ID: ${chainId}, Signer: ${signerAddress}`);
  logger.info(`Using Aerodrome Router at: ${routerAddress}`);

  // Get token details
  const tokenToSwap = await getTokenFromAddress(chainId, provider, tokenAddress);
  const targetToken = await getTokenFromAddress(chainId, provider, targetTokenAddress);

  if (tokenToSwap.address.toLowerCase() === targetToken.address.toLowerCase()) {
    logger.info('Tokens are identical, no swap necessary');
    return { success: true };
  }

  // Get contract instances
  const tokenContract = new Contract(tokenAddress, ERC20_ABI, signer);
  const routerContract = new Contract(routerAddress, AERODROME_ROUTER_ABI, signer);
  const factoryContract = new Contract(factoryAddress, AERODROME_FACTORY_ABI, provider);

  try {
    // STEP 1: Find which pool exists (stable or volatile)
    let poolAddress: string;
    let isStable: boolean;

    if (poolType) {
      // Use specified pool type
      isStable = poolType === 'stable';
      poolAddress = await factoryContract.getPool(tokenAddress, targetTokenAddress, isStable);

      if (poolAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error(`No Aerodrome ${poolType} pool exists for ${tokenToSwap.symbol}/${targetToken.symbol}`);
      }
      logger.info(`Found Aerodrome ${poolType} pool at ${poolAddress} for ${tokenToSwap.symbol}/${targetToken.symbol}`);
    } else {
      // Try volatile first (more common)
      poolAddress = await factoryContract.getPool(tokenAddress, targetTokenAddress, false);
      isStable = false;

      if (poolAddress === '0x0000000000000000000000000000000000000000') {
        // Try stable pool
        poolAddress = await factoryContract.getPool(tokenAddress, targetTokenAddress, true);
        isStable = true;

        if (poolAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error(`No Aerodrome pool exists for ${tokenToSwap.symbol}/${targetToken.symbol} (tried both stable and volatile)`);
        }
        logger.info(`Found Aerodrome stable pool at ${poolAddress} for ${tokenToSwap.symbol}/${targetToken.symbol}`);
      } else {
        logger.info(`Found Aerodrome volatile pool at ${poolAddress} for ${tokenToSwap.symbol}/${targetToken.symbol}`);
      }
    }

    // STEP 2: Get quote for expected output
    const route: Route = {
      from: tokenAddress,
      to: targetTokenAddress,
      stable: isStable,
      factory: factoryAddress,
    };

    const amounts = await routerContract.getAmountsOut(amount, [route]);
    const expectedAmountOut = amounts[1]; // For single-hop route

    logger.info(`Input amount: ${weiToDecimaled(amount, tokenToSwap.decimals)} ${tokenToSwap.symbol}`);
    logger.info(`Expected output: ${weiToDecimaled(expectedAmountOut, targetToken.decimals)} ${targetToken.symbol}`);

    // Calculate minimum output with slippage
    const slippageBasisPoints = slippagePercentage * 100;
    const minAmountOut = expectedAmountOut.mul(10000 - slippageBasisPoints).div(10000);

    logger.info(`Minimum output with ${slippagePercentage}% slippage: ${weiToDecimaled(minAmountOut, targetToken.decimals)} ${targetToken.symbol}`);

    // STEP 3: Approve router if needed
    const currentAllowance = await tokenContract.allowance(signerAddress, routerAddress);
    logger.info(`Current Aerodrome router allowance: ${weiToDecimaled(currentAllowance, tokenToSwap.decimals)} ${tokenToSwap.symbol}`);

    if (currentAllowance.lt(amount)) {
      logger.info(`Approving Aerodrome router to spend ${tokenToSwap.symbol}`);
      await NonceTracker.queueTransaction(signer, async (nonce) => {
        const approveTx = await tokenContract.approve(routerAddress, ethers.constants.MaxUint256, { nonce });
        logger.info(`Aerodrome approval transaction sent: ${approveTx.hash}`);
        const receipt = await approveTx.wait();
        logger.info(`Aerodrome approval confirmed!`);
        return receipt;
      });
    } else {
      logger.info(`Aerodrome router already has sufficient allowance for ${tokenToSwap.symbol}`);
    }

    // STEP 4: Execute swap
    const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes

    logger.debug('Aerodrome swap parameters:');
    logger.debug(`   amountIn: ${weiToDecimaled(amount, tokenToSwap.decimals)}`);
    logger.debug(`   amountOutMin: ${weiToDecimaled(minAmountOut, targetToken.decimals)}`);
    logger.debug(`   route: ${tokenAddress} -> ${targetTokenAddress} (${isStable ? 'stable' : 'volatile'})`);
    logger.debug(`   deadline: ${new Date(deadline * 1000).toLocaleString()}`);

    const gasPrice = await provider.getGasPrice();
    const highGasPrice = gasPrice.mul(115).div(100); // 15% higher
    logger.info(`Using gas price: ${ethers.utils.formatUnits(highGasPrice, 'gwei')} gwei (15% higher than current)`);

    const receipt = await NonceTracker.queueTransaction(signer, async (nonce) => {
      const swapTx = await routerContract.swapExactTokensForTokens(
        amount,
        minAmountOut,
        [route],
        signerAddress,
        deadline,
        {
          nonce,
          gasLimit: 500000, // Conservative gas limit for Aerodrome (V2-style is cheaper than V3)
          gasPrice: highGasPrice
        }
      );

      logger.info(`Aerodrome transaction sent: ${swapTx.hash}`);

      logger.info(`Waiting for transaction confirmation...`);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Transaction confirmation timeout after 2 minutes")), 120000)
      );

      // Race between confirmation and timeout
      return await Promise.race([
        swapTx.wait(),
        timeoutPromise
      ]);
    });

    logger.info(`Transaction confirmed: ${receipt.transactionHash}`);
    logger.info(`Gas used: ${receipt.gasUsed.toString()}`);
    logger.info(
      `Aerodrome swap successful for token: ${tokenToSwap.symbol}, amount: ${weiToDecimaled(amount, tokenToSwap.decimals)} to ${targetToken.symbol} (${isStable ? 'stable' : 'volatile'} pool)`
    );

    return { success: true, receipt, poolType: isStable ? 'stable' : 'volatile' };

  } catch (error: any) {
    logger.error(`Aerodrome swap failed for token: ${tokenAddress}: ${error}`);
    return { success: false, error: error.toString() };
  }
}
