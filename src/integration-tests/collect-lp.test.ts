import { AjnaSDK, FungiblePool } from '@ajna-finance/sdk';

import { expect } from 'chai';
import { BigNumber, Wallet, constants } from 'ethers';
import { LpCollector } from '../collect-lp';

import { configureAjna, TokenToCollect } from '../config-types';
import { DexRouter } from '../dex-router';
import { getBalanceOfErc20 } from '../erc20';
import { handleKicks } from '../kick';
import { NonceTracker } from '../nonce';
import { RewardActionTracker } from '../reward-action-tracker';
import { handleTakes, handleTakesWith1inch } from '../take';
import { delay, waitForConditionToBeTrue } from '../utils';
import { depositQuoteToken, drawDebt } from './loan-helpers';
import './subgraph-mock';
import {
  makeGetHighestMeaningfulBucket,
  makeGetLiquidationsFromSdk,
  makeGetLoansFromSdk,
  overrideGetHighestMeaningfulBucket,
  overrideGetLiquidations,
  overrideGetLoans,
} from './subgraph-mock';
import { MAINNET_CONFIG, USER1_MNEMONIC } from './test-config';
import {
  getProvider,
  impersonateSigner,
  increaseTime,
  resetHardhat,
  createTestKeeperConfig,
  makeConfigPick,
} from './test-utils';
import { SECONDS_PER_YEAR, SECONDS_PER_DAY } from '../constants';

const setup = async () => {
  configureAjna(MAINNET_CONFIG.AJNA_CONFIG);
  const ajna = new AjnaSDK(getProvider());
  const pool: FungiblePool = await ajna.fungiblePoolFactory.getPoolByAddress(
    MAINNET_CONFIG.SOL_WETH_POOL.poolConfig.address
  );
  overrideGetLoans(makeGetLoansFromSdk(pool));
  overrideGetLiquidations(makeGetLiquidationsFromSdk(pool));
  overrideGetHighestMeaningfulBucket(makeGetHighestMeaningfulBucket(pool));
  await depositQuoteToken({
    pool,
    owner: MAINNET_CONFIG.SOL_WETH_POOL.quoteWhaleAddress,
    amount: 1,
    price: 0.07,
  });
  await drawDebt({
    pool,
    owner: MAINNET_CONFIG.SOL_WETH_POOL.collateralWhaleAddress,
    amountToBorrow: 0.9,
    collateralToPledge: 14,
  });
  await increaseTime(SECONDS_PER_YEAR * 2);
  const signer = await impersonateSigner(
    MAINNET_CONFIG.SOL_WETH_POOL.collateralWhaleAddress2
  );
  await handleKicks({
    pool,
    poolConfig: MAINNET_CONFIG.SOL_WETH_POOL.poolConfig,
    signer,
    config: makeConfigPick(
      [
        'dryRun',
        'subgraphUrl',
        'coinGeckoApiKey',
        'delayBetweenActions',
        'ethRpcUrl',
        'tokenAddresses',
      ] as const,
      {
        dryRun: false,
        subgraphUrl: '',
        coinGeckoApiKey: '',
        delayBetweenActions: 0,
      }
    ),
  });
  await increaseTime(SECONDS_PER_DAY * 1.5);
  return pool;
};

describe('LpCollector subscription', () => {
  beforeEach(async () => {
    await resetHardhat();
  });

  it('Tracks taker reward after BucketTake', async () => {
    const pool = await setup();
    const signer = await impersonateSigner(
      MAINNET_CONFIG.SOL_WETH_POOL.quoteWhaleAddress2
    );
    const dexRouter = new DexRouter(signer);
    const lpCollector = new LpCollector(
      pool,
      signer,
      {
        collectLpReward: {
          redeemFirst: TokenToCollect.QUOTE,
          minAmountQuote: 0,
          minAmountCollateral: 0,
        },
      },
      makeConfigPick(['dryRun'] as const, { dryRun: false }),
      new RewardActionTracker(
        signer,
        createTestKeeperConfig({
          uniswapOverrides: {
            wethAddress: MAINNET_CONFIG.WETH_ADDRESS,
            uniswapV3Router: MAINNET_CONFIG.UNISWAP_V3_ROUTER,
          },
        }),
        dexRouter
      )
    );
    await lpCollector.startSubscription();
    await handleTakesWith1inch({
      pool,
      poolConfig: MAINNET_CONFIG.SOL_WETH_POOL.poolConfig,
      signer,
      config: makeConfigPick(
        [
          'dryRun',
          'subgraphUrl',
          'delayBetweenActions',
          'connectorTokens',
          'oneInchRouters',
          'keeperTaker',
          'keeperTakerFactory',
          'takerContracts',
          'universalRouterOverrides',
          'sushiswapRouterOverrides',
          'curveRouterOverrides',
          'tokenAddresses',
        ] as const,
        {
          dryRun: false,
          subgraphUrl: '',
          delayBetweenActions: 0,
          oneInchRouters: {},
          connectorTokens: [],
        }
      ),
    });
    await waitForConditionToBeTrue(async () => {
      const entries = Array.from(lpCollector.lpMap.entries());
      const rewardLp: BigNumber | undefined = entries?.[0]?.[1];
      return !!rewardLp && rewardLp.gt(constants.Zero);
    });
    await lpCollector.stopSubscription();
  });

  it('Does not track bucket takes of other users', async () => {
    const pool = await setup();
    const wallet = Wallet.fromMnemonic(USER1_MNEMONIC);
    const noActionSigner = wallet.connect(getProvider());
    const dexRouter = new DexRouter(noActionSigner);
    const lpCollector = new LpCollector(
      pool,
      noActionSigner,
      {
        collectLpReward: {
          redeemFirst: TokenToCollect.QUOTE,
          minAmountQuote: 0,
          minAmountCollateral: 0,
        },
      },
      makeConfigPick(['dryRun'] as const, { dryRun: false }),
      new RewardActionTracker(
        noActionSigner,
        createTestKeeperConfig({
          uniswapOverrides: {
            wethAddress: MAINNET_CONFIG.WETH_ADDRESS,
            uniswapV3Router: MAINNET_CONFIG.UNISWAP_V3_ROUTER,
          },
        }),
        dexRouter
      )
    );
    await lpCollector.startSubscription();
    const takerSigner = await impersonateSigner(
      MAINNET_CONFIG.SOL_WETH_POOL.collateralWhaleAddress2
    );
    await handleTakesWith1inch({
      pool,
      poolConfig: MAINNET_CONFIG.SOL_WETH_POOL.poolConfig,
      signer: takerSigner,
      config: makeConfigPick(
        [
          'dryRun',
          'subgraphUrl',
          'delayBetweenActions',
          'connectorTokens',
          'oneInchRouters',
          'keeperTaker',
          'keeperTakerFactory',
          'takerContracts',
          'universalRouterOverrides',
          'sushiswapRouterOverrides',
          'curveRouterOverrides',
          'tokenAddresses',
        ] as const,
        {
          dryRun: false,
          subgraphUrl: '',
          delayBetweenActions: 0,
          oneInchRouters: {},
          connectorTokens: [],
        }
      ),
    });
    await delay(5);
    const entries = Array.from(lpCollector.lpMap.entries());
    expect(entries.length).equals(0);
    await lpCollector.stopSubscription();
  });

  it('Tracks rewards for kicker', async () => {
    const pool = await setup();
    const kickerSigner = await impersonateSigner(
      MAINNET_CONFIG.SOL_WETH_POOL.collateralWhaleAddress2
    );
    const dexRouter = new DexRouter(kickerSigner);
    const lpCollector = new LpCollector(
      pool,
      kickerSigner,
      {
        collectLpReward: {
          redeemFirst: TokenToCollect.QUOTE,
          minAmountQuote: 0,
          minAmountCollateral: 0,
        },
      },
      makeConfigPick(['dryRun'] as const, { dryRun: false }),
      new RewardActionTracker(
        kickerSigner,
        createTestKeeperConfig({
          uniswapOverrides: {
            wethAddress: MAINNET_CONFIG.WETH_ADDRESS,
            uniswapV3Router: MAINNET_CONFIG.UNISWAP_V3_ROUTER,
          },
        }),
        dexRouter
      )
    );
    await lpCollector.startSubscription();
    await delay(5);
    const takerSigner = await impersonateSigner(
      MAINNET_CONFIG.SOL_WETH_POOL.quoteWhaleAddress2
    );
    await handleTakesWith1inch({
      pool,
      poolConfig: MAINNET_CONFIG.SOL_WETH_POOL.poolConfig,
      signer: takerSigner,
      config: makeConfigPick(
        [
          'dryRun',
          'subgraphUrl',
          'delayBetweenActions',
          'connectorTokens',
          'oneInchRouters',
          'keeperTaker',
          'keeperTakerFactory',
          'takerContracts',
          'universalRouterOverrides',
          'sushiswapRouterOverrides',
          'curveRouterOverrides',
          'tokenAddresses',
        ] as const,
        {
          dryRun: false,
          subgraphUrl: '',
          delayBetweenActions: 0,
          oneInchRouters: {},
          connectorTokens: [],
        }
      ),
    });
    await waitForConditionToBeTrue(async () => {
      const entries = Array.from(lpCollector.lpMap.entries());
      const rewardLp: BigNumber | undefined = entries?.[0]?.[1];
      return !!rewardLp && rewardLp.gt(constants.Zero);
    });
    await lpCollector.stopSubscription();
  });
});

describe('LpCollector collections', () => {
  beforeEach(async () => {
    await resetHardhat();
  });

  // TODO: Refactor this into two tests, one redeeming quote first and another redeeming collateral first
  it('Collects tracked rewards', async () => {
    const pool = await setup();
    const signer = await impersonateSigner(
      MAINNET_CONFIG.SOL_WETH_POOL.collateralWhaleAddress2
    );
    const dexRouter = new DexRouter(signer);

    const lpCollector = new LpCollector(
      pool,
      signer,
      {
        collectLpReward: {
          redeemFirst: TokenToCollect.QUOTE,
          minAmountQuote: 0,
          minAmountCollateral: 0,
        },
      },
      makeConfigPick(['dryRun'] as const, { dryRun: false }),
      new RewardActionTracker(
        signer,
        createTestKeeperConfig({
          uniswapOverrides: {
            wethAddress: MAINNET_CONFIG.WETH_ADDRESS,
            uniswapV3Router: MAINNET_CONFIG.UNISWAP_V3_ROUTER,
          },
        }),
        dexRouter
      )
    );
    await lpCollector.startSubscription();
    await handleTakesWith1inch({
      pool,
      poolConfig: MAINNET_CONFIG.SOL_WETH_POOL.poolConfig,
      signer,
      config: makeConfigPick(
        [
          'dryRun',
          'subgraphUrl',
          'delayBetweenActions',
          'connectorTokens',
          'oneInchRouters',
          'keeperTaker',
          'keeperTakerFactory',
          'takerContracts',
          'universalRouterOverrides',
          'sushiswapRouterOverrides',
          'curveRouterOverrides',
          'tokenAddresses',
        ] as const,
        {
          dryRun: false,
          subgraphUrl: '',
          delayBetweenActions: 0,
          oneInchRouters: {},
          connectorTokens: [],
        }
      ),
    });
    await waitForConditionToBeTrue(async () => {
      const entries = Array.from(lpCollector.lpMap.entries());
      const rewardLp: BigNumber | undefined = entries?.[0]?.[1];
      return !!rewardLp && rewardLp.gt(constants.Zero);
    });
    const liquidation = pool.getLiquidation(
      MAINNET_CONFIG.SOL_WETH_POOL.collateralWhaleAddress
    );
    const settleTx = await liquidation.settle(signer);
    await settleTx.verifyAndSubmit();
    await NonceTracker.getNonce(signer);

    const balanceBeforeCollection = await getBalanceOfErc20(
      signer,
      pool.quoteAddress
    );
    await lpCollector.collectLpRewards();
    const balanceAfterCollection = await getBalanceOfErc20(
      signer,
      pool.quoteAddress
    );
    expect(balanceAfterCollection.gt(balanceBeforeCollection)).to.be.true;
    await lpCollector.stopSubscription();
  });
});
