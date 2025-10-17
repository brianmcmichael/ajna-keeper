// src/dex-providers/aerodrome-quote-provider.ts
// AERODROME INTEGRATION: Quote provider for Aerodrome Finance on Base network
// Aerodrome is a V2-style DEX (fork of Velodrome) with both stable and volatile pools

import { ethers, BigNumber, Signer } from 'ethers';
import { logger } from '../logging';
import { getDecimalsErc20 } from '../erc20';

// Aerodrome Router ABI - minimal interface for quoting
const AERODROME_ROUTER_ABI = [
  // Route struct: (address from, address to, bool stable, address factory)
  `function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] memory routes)
   external view returns (uint256[] memory amounts)`,
  'function defaultFactory() external view returns (address)',
  'function factoryRegistry() external view returns (address)',
];

const AERODROME_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)',
  'function isPair(address pool) external view returns (bool)',
];

interface AerodromeQuoteConfig {
  routerAddress: string;
  factoryAddress: string;
  wethAddress: string;
  defaultPoolType?: 'stable' | 'volatile';
}

interface QuoteResult {
  success: boolean;
  dstAmount?: BigNumber;
  error?: string;
  poolType?: 'stable' | 'volatile';
}

// Route structure for Aerodrome
interface Route {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
}

/**
 * Aerodrome Quote Provider for External Take Profitability Analysis
 *
 * Uses Aerodrome's Router contract for accurate pricing.
 * Aerodrome is a V2-style DEX with support for both stable and volatile pools.
 */
export class AerodromeQuoteProvider {
  private signer: Signer;
  private config: AerodromeQuoteConfig;
  private routerContract: ethers.Contract;
  private factoryContract: ethers.Contract;
  private isInitialized: boolean = false;

  constructor(signer: Signer, config: AerodromeQuoteConfig) {
    this.signer = signer;
    this.config = config;

    // Initialize router contract
    this.routerContract = new ethers.Contract(
      config.routerAddress,
      AERODROME_ROUTER_ABI,
      signer
    );

    // Initialize factory contract
    this.factoryContract = new ethers.Contract(
      config.factoryAddress,
      AERODROME_FACTORY_ABI,
      signer
    );
  }

  /**
   * Initialize and validate the quote provider
   */
  async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      // Test router connection
      const routerCode = await this.signer.provider!.getCode(this.config.routerAddress);
      if (routerCode === '0x') {
        logger.warn(`Aerodrome router not found at ${this.config.routerAddress}`);
        return false;
      }

      // Test factory connection
      const factoryCode = await this.signer.provider!.getCode(this.config.factoryAddress);
      if (factoryCode === '0x') {
        logger.warn(`Aerodrome factory not found at ${this.config.factoryAddress}`);
        return false;
      }

      // Verify router is working by checking defaultFactory
      try {
        const defaultFactory = await this.routerContract.defaultFactory();
        logger.debug(`Aerodrome Router initialized at ${this.config.routerAddress}, default factory: ${defaultFactory}`);
      } catch (error) {
        logger.warn(`Aerodrome Router validation failed: ${error}`);
        return false;
      }

      this.isInitialized = true;
      return true;

    } catch (error) {
      logger.error(`Failed to initialize Aerodrome quote provider: ${error}`);
      return false;
    }
  }

  /**
   * Check if quote provider is available and ready
   */
  isAvailable(): boolean {
    return this.isInitialized;
  }

  /**
   * Get Router address being used
   */
  getRouterAddress(): string {
    return this.config.routerAddress;
  }

  /**
   * Check if pool exists for the given token pair
   * Tries both stable and volatile pools
   */
  async poolExists(
    tokenA: string,
    tokenB: string,
    poolType?: 'stable' | 'volatile'
  ): Promise<{ exists: boolean; isStable?: boolean; poolAddress?: string }> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // If pool type is specified, only check that type
      if (poolType) {
        const stable = poolType === 'stable';
        const poolAddress = await this.factoryContract.getPool(tokenA, tokenB, stable);
        const exists = poolAddress !== '0x0000000000000000000000000000000000000000';

        if (exists) {
          logger.debug(`Aerodrome ${poolType} pool found: ${tokenA}/${tokenB} at ${poolAddress}`);
          return { exists: true, isStable: stable, poolAddress };
        } else {
          logger.debug(`Aerodrome ${poolType} pool NOT found: ${tokenA}/${tokenB}`);
          return { exists: false };
        }
      }

      // Try both stable and volatile pools
      // First try volatile (more common)
      let poolAddress = await this.factoryContract.getPool(tokenA, tokenB, false);
      let exists = poolAddress !== '0x0000000000000000000000000000000000000000';

      if (exists) {
        logger.debug(`Aerodrome volatile pool found: ${tokenA}/${tokenB} at ${poolAddress}`);
        return { exists: true, isStable: false, poolAddress };
      }

      // Try stable pool
      poolAddress = await this.factoryContract.getPool(tokenA, tokenB, true);
      exists = poolAddress !== '0x0000000000000000000000000000000000000000';

      if (exists) {
        logger.debug(`Aerodrome stable pool found: ${tokenA}/${tokenB} at ${poolAddress}`);
        return { exists: true, isStable: true, poolAddress };
      }

      logger.debug(`Aerodrome pool NOT found: ${tokenA}/${tokenB} (tried both stable and volatile)`);
      return { exists: false };

    } catch (error) {
      logger.debug(`Error checking Aerodrome pool existence: ${error}`);
      return { exists: false };
    }
  }

  /**
   * Get accurate quote from Aerodrome Router contract
   * Automatically detects whether to use stable or volatile pool
   */
  async getQuote(
    amountIn: BigNumber,
    tokenIn: string,
    tokenOut: string,
    poolType?: 'stable' | 'volatile'
  ): Promise<QuoteResult> {
    try {
      if (!this.isInitialized) {
        const initialized = await this.initialize();
        if (!initialized) {
          return { success: false, error: 'Quote provider not available' };
        }
      }

      // Check which pool exists and get its type
      const poolInfo = await this.poolExists(tokenIn, tokenOut, poolType);
      if (!poolInfo.exists) {
        return {
          success: false,
          error: poolType
            ? `No Aerodrome ${poolType} pool for ${tokenIn}/${tokenOut}`
            : `No Aerodrome pool for ${tokenIn}/${tokenOut}`
        };
      }

      // Create route struct
      const route: Route = {
        from: tokenIn,
        to: tokenOut,
        stable: poolInfo.isStable!,
        factory: this.config.factoryAddress,
      };

      // Get quote from router
      logger.debug(`Aerodrome quote params: tokenIn=${tokenIn}, tokenOut=${tokenOut}, amountIn=${amountIn.toString()}, stable=${route.stable}`);

      const amounts = await this.routerContract.getAmountsOut(amountIn, [route]);

      // getAmountsOut returns an array: [amountIn, amountOut, ...]
      // For a single-hop route, amounts[1] is our output
      const amountOut = amounts[1];

      if (amountOut.isZero()) {
        return { success: false, error: 'Zero output from Aerodrome router' };
      }

      // Get correct decimals for proper formatting
      const inputDecimals = await getDecimalsErc20(this.signer, tokenIn);
      const outputDecimals = await getDecimalsErc20(this.signer, tokenOut);

      logger.debug(`Aerodrome quote success: ${ethers.utils.formatUnits(amountIn, inputDecimals)} in -> ${ethers.utils.formatUnits(amountOut, outputDecimals)} out (${route.stable ? 'stable' : 'volatile'} pool)`);

      return {
        success: true,
        dstAmount: amountOut,
        poolType: route.stable ? 'stable' : 'volatile',
      };

    } catch (error: any) {
      logger.debug(`Aerodrome quote failed: ${error.message}`);

      // Parse common errors
      if (error.message?.includes('INSUFFICIENT_LIQUIDITY')) {
        return { success: false, error: 'Insufficient liquidity in Aerodrome pool' };
      } else if (error.message?.includes('revert')) {
        return { success: false, error: `Aerodrome router reverted: ${error.reason || error.message}` };
      } else {
        return { success: false, error: `Aerodrome quote error: ${error.message}` };
      }
    }
  }

  /**
   * Calculate market price from quote (quote tokens per collateral token)
   */
  async getMarketPrice(
    amountIn: BigNumber,
    tokenIn: string,
    tokenOut: string,
    tokenInDecimals: number,
    tokenOutDecimals: number,
    poolType?: 'stable' | 'volatile'
  ): Promise<{ success: boolean; price?: number; error?: string; poolType?: 'stable' | 'volatile' }> {
    try {
      const quoteResult = await this.getQuote(amountIn, tokenIn, tokenOut, poolType);

      if (!quoteResult.success || !quoteResult.dstAmount) {
        return { success: false, error: quoteResult.error };
      }

      // Calculate price: output tokens per input token
      const inputAmount = Number(ethers.utils.formatUnits(amountIn, tokenInDecimals));
      const outputAmount = Number(ethers.utils.formatUnits(quoteResult.dstAmount, tokenOutDecimals));

      if (inputAmount <= 0 || outputAmount <= 0) {
        return { success: false, error: 'Invalid amounts for price calculation' };
      }

      const marketPrice = outputAmount / inputAmount;

      logger.debug(`Aerodrome market price: 1 ${tokenIn} = ${marketPrice.toFixed(6)} ${tokenOut} (${quoteResult.poolType} pool)`);

      return {
        success: true,
        price: marketPrice,
        poolType: quoteResult.poolType
      };

    } catch (error: any) {
      return { success: false, error: `Market price calculation failed: ${error.message}` };
    }
  }
}
