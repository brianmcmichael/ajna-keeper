import { gql, request } from 'graphql-request';

export interface GetLoanResponse {
  loans: {
    borrower: string;
    thresholdPrice: number;
  }[];
}

async function getLoans(subgraphUrl: string, poolAddress: string) {
  const query = gql`
    query {
      loans (where: {inLiquidation: false, poolAddress: "${poolAddress.toLowerCase()}"}){
        borrower
        thresholdPrice
      }
    }
  `;

  const result: GetLoanResponse = await request(subgraphUrl, query);
  return result;
}

export interface GetLiquidationResponse {
  pool: {
    hpb: number;
    hpbIndex: number;
    liquidationAuctions: {
      borrower: string;
    }[];
  };
}

async function getLiquidations(
  subgraphUrl: string,
  poolAddress: string,
  minCollateral: number
) {
  // TODO: Should probably sort auctions by kickTime so that we kick the most profitable auctions first.
  const query = gql`
    query {
      pool (id: "${poolAddress.toLowerCase()}") {
        hpb
        hpbIndex
        liquidationAuctions (where: {collateralRemaining_gt: "${minCollateral}"}) {
          borrower
        }
      }
    }
  `;

  const result: GetLiquidationResponse = await request(subgraphUrl, query);
  return result;
}

export interface GetMeaningfulBucketResponse {
  buckets: {
    bucketIndex: number;
  }[];
}

async function getHighestMeaningfulBucket(
  subgraphUrl: string,
  poolAddress: string,
  minDeposit: string
) {
  const query = gql`
    query {
      buckets(
        where: {
          deposit_gt: "${minDeposit}"
          poolAddress: "${poolAddress.toLowerCase()}"
        }
        first: 1
        orderBy: bucketPrice
        orderDirection: desc
      ) {
        bucketIndex
      }
    }
  `;

  const result: GetMeaningfulBucketResponse = await request(subgraphUrl, query);
  return result;
}

export interface GetUnsettledAuctionsResponse {
  liquidationAuctions: {
    borrower: string;
    kickTime: string;
    debtRemaining: string;
    collateralRemaining: string;
    neutralPrice: string;
    debt: string;
    collateral: string;
  }[];
}

async function getUnsettledAuctions(subgraphUrl: string, poolAddress: string) {
  const query = gql`
    query GetUnsettledAuctions($poolId: String!) {
      liquidationAuctions(
        where: {
          pool: $poolId,
          settled: false
        }
      ) {
        borrower
        kickTime
        debtRemaining
        collateralRemaining
        neutralPrice
        debt
        collateral
      }
    }
  `;

  const result: GetUnsettledAuctionsResponse = await request(subgraphUrl, query, {
    poolId: poolAddress.toLowerCase()
  });
  return result;
}

export interface PoolSnapshotLoan {
  borrower: string;
  thresholdPrice: string;
  t0debt: string;
  t0Np: string;
  collateralPledged: string;
}

export interface PoolSnapshotAuction {
  borrower: string;
  collateralRemaining: string;
  debtRemaining: string;
  neutralPrice: string;
  thresholdPrice: string;
  kickTime: string;
  settled: boolean;
}

export interface PoolSnapshotBucket {
  bucketIndex: number;
  bucketPrice: string;
  deposit: string;
}

export interface PoolSnapshot {
  id: string;
  hpb: string;
  hpbIndex: number;
  lup: string;
  lupIndex: number;
  loans: PoolSnapshotLoan[];
  liquidationAuctions: PoolSnapshotAuction[];
  buckets: PoolSnapshotBucket[];
}

export interface GetPoolsSnapshotOptions {
  /** Maximum number of buckets to fetch per pool (default: 20) */
  maxBuckets?: number;
  /** Maximum number of loans to fetch per pool (default: 1000) */
  maxLoans?: number;
  /** Maximum number of liquidation auctions to fetch per pool (default: 1000) */
  maxAuctions?: number;
  /** Minimum deposit filter applied to buckets (default: "0") */
  minBucketDeposit?: string;
}

interface PoolSnapshotResponse {
  pools: Array<{
    id: string;
    hpb: string;
    hpbIndex: number;
    lup: string;
    lupIndex: number;
    loans: PoolSnapshotLoan[];
    liquidationAuctions: PoolSnapshotAuction[];
    buckets: PoolSnapshotBucket[];
  }>;
}

async function getPoolsSnapshot(
  subgraphUrl: string,
  poolAddresses: string[],
  options?: GetPoolsSnapshotOptions
): Promise<PoolSnapshot[]> {
  if (!poolAddresses.length) {
    return [];
  }

  const {
    maxBuckets = 20,
    maxLoans = 1000,
    maxAuctions = 1000,
    minBucketDeposit = '0',
  } = options ?? {};
  const poolIds = poolAddresses.map((address) => address.toLowerCase());

  const query = gql`
    query PoolSnapshots(
      $poolIds: [String!]!
      $maxBuckets: Int!
      $maxLoans: Int!
      $maxAuctions: Int!
      $minDeposit: BigDecimal!
    ) {
      pools(where: { id_in: $poolIds }) {
        id
        hpb
        hpbIndex
        lup
        lupIndex
        loans(first: $maxLoans, where: { inLiquidation: false }) {
          borrower
          thresholdPrice
          t0debt
          t0Np
          collateralPledged
        }
        liquidationAuctions(first: $maxAuctions, where: { settled: false }) {
          borrower
          collateralRemaining
          debtRemaining
          neutralPrice
          thresholdPrice
          kickTime
          settled
        }
        buckets(
          first: $maxBuckets
          where: { deposit_gt: $minDeposit }
          orderBy: bucketPrice
          orderDirection: desc
        ) {
          bucketIndex
          bucketPrice
          deposit
        }
      }
    }
  `;

  const variables = {
    poolIds,
    maxBuckets,
    maxLoans,
    maxAuctions,
    minDeposit: minBucketDeposit,
  };

  const result: PoolSnapshotResponse = await request(
    subgraphUrl,
    query,
    variables
  );

  return result.pools.map((pool) => ({
    id: pool.id,
    hpb: pool.hpb,
    hpbIndex: pool.hpbIndex,
    lup: pool.lup,
    lupIndex: pool.lupIndex,
    loans: pool.loans,
    liquidationAuctions: pool.liquidationAuctions,
    buckets: pool.buckets,
  }));
}


// Exported as default module to enable mocking in tests.
export default { 
  getLoans, 
  getLiquidations, 
  getHighestMeaningfulBucket, 
  getUnsettledAuctions,
  getPoolsSnapshot,
};
