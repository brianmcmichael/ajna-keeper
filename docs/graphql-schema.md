# Ajna Keeper Subgraph Entities

Snapshot of the key GraphQL entities used by the keeper so we can work offline without re-introspecting.

## Pool
- `id: Bytes!`
- `createdAtBlockNumber: BigInt!`
- `createdAtTimestamp: BigInt!`
- `collateralToken: Token!`
- `quoteToken: Token!`
- `poolSize: BigDecimal!`
- `t0debt: BigDecimal!`
- `inflator: BigDecimal!`
- `borrowRate: BigDecimal!`
- `lendRate: BigDecimal!`
- `borrowFeeRate: BigDecimal!`
- `depositFeeRate: BigDecimal!`
- `pledgedCollateral: BigDecimal!`
- `totalInterestEarned: BigDecimal!`
- `txCount: BigInt!`
- `poolType: String!`
- `loansCount: BigInt!`
- `maxBorrower: Bytes!`
- `quoteTokenFlashloaned: BigDecimal!`
- `collateralFlashloaned: BigDecimal!`
- `hpb: BigDecimal!`
- `hpbIndex: Int!`
- `htp: BigDecimal!`
- `htpIndex: Int!`
- `lup: BigDecimal!`
- `lupIndex: Int!`
- `reserves: BigDecimal!`
- `claimableReserves: BigDecimal!`
- `claimableReservesRemaining: BigDecimal!`
- `burnEpoch: BigInt!`
- `totalAjnaBurned: BigDecimal!`
- `reserveAuctions: [ReserveAuction!]!`
- `minDebtAmount: BigDecimal!`
- `actualUtilization: BigDecimal!`
- `targetUtilization: BigDecimal!`
- `totalBondEscrowed: BigDecimal!`
- `liquidationAuctions: [LiquidationAuction!]!`
- `quoteTokenBalance: BigDecimal!`
- `collateralBalance: BigDecimal!`
- `subsetHash: Bytes!`
- `tokenIdsPledged: [String!]!`
- `bucketTokenIds: [String!]!`
- `tokenIdsAllowed: [String!]!`

## Loan
- `id: Bytes!`
- `poolAddress: String!`
- `borrower: Bytes!`
- `pool: Pool!`
- `inLiquidation: Boolean!`
- `liquidationAuction: LiquidationAuction`
- `collateralPledged: BigDecimal!`
- `thresholdPrice: BigDecimal!`
- `tokenIdsPledged: [String!]!`
- `t0debt: BigDecimal!`
- `t0Np: BigDecimal!`

## LiquidationAuction
- `id: Bytes!`
- `pool: Pool!`
- `borrower: Bytes!`
- `lastTakePrice: BigDecimal!`
- `collateral: BigDecimal!`
- `collateralRemaining: BigDecimal!`
- `debt: BigDecimal!`
- `debtRemaining: BigDecimal!`
- `loan: Loan!`
- `kicker: Bytes!`
- `kick: Kick!`
- `kickTime: BigInt!`
- `takes: [Take!]!`
- `bucketTakes: [BucketTake!]!`
- `settles: [AuctionSettle!]!`
- `settle: AuctionSettle`
- `settleTime: BigInt`
- `settled: Boolean!`
- `bondSize: BigDecimal!`
- `bondFactor: BigDecimal!`
- `neutralPrice: BigDecimal!`
- `referencePrice: BigDecimal!`
- `thresholdPrice: BigDecimal!`

## Bucket
- `id: Bytes!`
- `bucketIndex: Int!`
- `bucketPrice: BigDecimal!`
- `exchangeRate: BigDecimal!`
- `poolAddress: String!`
- `pool: Pool!`
- `collateral: BigDecimal!`
- `deposit: BigDecimal!`
- `lpb: BigDecimal!`
- `lends: [Lend!]!`
- `positionLends: [PositionLend!]!`
