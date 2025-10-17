// src/pool-interest.ts
// Utility for updating stale pool interest rates

import { FungiblePool, Signer } from '@ajna-finance/sdk';
import { logger } from './logging';
import { NonceTracker } from './nonce';

const ONE_WEEK_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

interface InterestUpdateResult {
  updated: boolean;
  lastUpdateTime?: number;
  staleness?: number;
}

/**
 * Check if pool interest needs updating and update if stale (>1 week old)
 *
 * In Ajna, interest accrues continuously but on-chain state isn't updated until
 * someone interacts with the pool. Stale interest can cause:
 * - Inaccurate TP (Threshold Price) calculations
 * - Missed liquidation opportunities
 * - Incorrect LUP (Lowest Utilized Price) readings
 *
 * This function "pokes" the pool to update interest if it's been >1 week.
 */
export async function updatePoolInterestIfStale(
  pool: FungiblePool,
  signer: Signer,
  dryRun: boolean = false
): Promise<InterestUpdateResult> {
  try {
    // Get pool contract interface
    const poolContract = pool.contract;

    // Call inflatorInfo() which returns (inflator, lastUpdate)
    // inflator: current interest rate multiplier (WAD precision)
    // lastUpdate: timestamp of last interest update (seconds)
    const inflatorInfo = await poolContract.inflatorInfo();
    const lastUpdateTime = inflatorInfo[1].toNumber(); // second element is timestamp

    const currentTime = Math.floor(Date.now() / 1000);
    const timeSinceUpdate = currentTime - lastUpdateTime;

    logger.debug(
      `Pool ${pool.name}: last interest update ${(timeSinceUpdate / 86400).toFixed(1)} days ago ` +
      `(${new Date(lastUpdateTime * 1000).toISOString()})`
    );

    // Only update if interest is stale (>1 week)
    if (timeSinceUpdate < ONE_WEEK_SECONDS) {
      return {
        updated: false,
        lastUpdateTime,
        staleness: timeSinceUpdate,
      };
    }

    logger.info(
      `Pool ${pool.name}: Interest is stale (${(timeSinceUpdate / 86400).toFixed(1)} days old), updating...`
    );

    if (dryRun) {
      logger.info(
        `DryRun - would update interest for pool ${pool.name} ` +
        `(stale for ${(timeSinceUpdate / 86400).toFixed(1)} days)`
      );
      return {
        updated: false,
        lastUpdateTime,
        staleness: timeSinceUpdate,
      };
    }

    // Estimate gas BEFORE entering the nonce queue to minimize nonce hold time
    const estimatedGas = await poolContract.connect(signer).estimateGas.updateInterest();
    // Add 30% padding for safety
    const gasLimit = estimatedGas.mul(130).div(100);

    logger.debug(
      `Updating interest for ${pool.name}: estimated gas ${estimatedGas}, using limit ${gasLimit}`
    );

    // Execute updateInterest() transaction with pre-calculated gas limit
    await NonceTracker.queueTransaction(signer, async (nonce) => {
      const tx = await poolContract.connect(signer).updateInterest({
        nonce,
        gasLimit,
      });

      logger.debug(`Interest update tx sent: ${tx.hash}`);
      const receipt = await tx.wait();
      logger.info(
        `✓ Interest updated for pool ${pool.name} ` +
        `(was ${(timeSinceUpdate / 86400).toFixed(1)} days stale, gas: ${receipt.gasUsed})`
      );

      return receipt;
    });

    return {
      updated: true,
      lastUpdateTime,
      staleness: timeSinceUpdate,
    };
  } catch (error) {
    logger.error(`Failed to update interest for pool ${pool.name}:`, error);
    return {
      updated: false,
    };
  }
}

/**
 * Get time since last interest update (in seconds)
 */
export async function getInterestStaleness(pool: FungiblePool): Promise<number> {
  try {
    const poolContract = pool.contract;
    const inflatorInfo = await poolContract.inflatorInfo();
    const lastUpdateTime = inflatorInfo[1].toNumber();
    const currentTime = Math.floor(Date.now() / 1000);
    return currentTime - lastUpdateTime;
  } catch (error) {
    logger.error(`Failed to get interest staleness for pool ${pool.name}:`, error);
    return 0;
  }
}

/**
 * Check if pool interest is stale (>1 week old)
 */
export async function isInterestStale(pool: FungiblePool): Promise<boolean> {
  const staleness = await getInterestStaleness(pool);
  return staleness > ONE_WEEK_SECONDS;
}
