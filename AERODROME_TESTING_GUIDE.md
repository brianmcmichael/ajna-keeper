# Aerodrome Integration Testing Guide

This guide provides comprehensive instructions for testing the Aerodrome Finance integration in the Ajna Keeper on Base network.

## Overview

Aerodrome Finance is a V2-style DEX (fork of Velodrome) on Base with two pool types:
- **Volatile pools**: For uncorrelated assets (e.g., WETH/USDC)
- **Stable pools**: For correlated assets (e.g., USDC/DAI)

The keeper automatically detects which pool type exists for a given token pair.

## Prerequisites

Before testing, ensure you have:

1. **Base network RPC access** (via Alchemy or another provider)
2. **Graph API key** for Ajna subgraph access
3. **Test wallet with gas funds** (Base ETH for transaction fees)
4. **Keeper smart contracts deployed** on Base network with `LiquiditySource.AERODROME = 5` support
5. **Node.js and dependencies installed** (`npm install`)

## Configuration Setup

### Step 1: Update Configuration File

Edit your config file (e.g., `example-base-config.ts` or create a new one):

```typescript
import { KeeperConfig, LiquiditySource } from './src/config-types';

const config: KeeperConfig = {
  // Enable dry-run mode for initial testing
  dryRun: true,
  logLevel: 'debug',

  // Base Chain RPC
  ethRpcUrl: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,

  // Aerodrome configuration
  aerodromeRouterOverrides: {
    routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',  // Aerodrome Router
    factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', // Aerodrome Factory
    wethAddress: '0x4200000000000000000000000000000000000006',   // WETH on Base
    defaultSlippage: 0.5,      // 0.5% slippage
    // defaultPoolType: 'volatile',  // Optional: 'stable' or 'volatile' (auto-detects if not set)
  },

  // Token addresses
  tokenAddresses: {
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },

  // Pool configuration with Aerodrome
  pools: [
    {
      name: 'WETH / USDC',
      address: '0x0b17159f2486f669a1f930926638008e2ccb4287',
      price: {
        source: PriceOriginSource.COINGECKO,
        query: 'price?ids=ethereum&vs_currencies=usd',
      },
      take: {
        minCollateral: 0.01,
        hpbPriceFactor: 0.9,
        // Enable Aerodrome for external takes
        liquiditySource: LiquiditySource.AERODROME,
        marketPriceFactor: 0.98,  // Take if auction price <= 98% of market price
      },
      // ... other pool settings
    },
  ],
};
```

### Step 2: Environment Variables

Create a `.env` file with required API keys:

```bash
# Alchemy API key for Base network RPC
ALCHEMY_API_KEY=your_alchemy_api_key

# The Graph API key for subgraph queries
GRAPH_API_KEY=your_graph_api_key

# CoinGecko API key (optional, for price feeds)
COINGECKO_API_KEY=your_coingecko_api_key

# Keystore password (if using encrypted keystore)
KEEPER_PASSWORD=your_keystore_password
```

## Testing Phases

### Phase 1: Quote Provider Testing (Dry-Run)

Test the Aerodrome quote provider in isolation to verify it can fetch prices.

#### Create a Test Script

Create `test-aerodrome-quotes.ts`:

```typescript
import { ethers } from 'ethers';
import { AerodromeQuoteProvider } from './src/dex-providers/aerodrome-quote-provider';

async function testAerodromeQuotes() {
  // Setup provider and signer
  const provider = new ethers.providers.JsonRpcProvider(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  const wallet = ethers.Wallet.createRandom().connect(provider);

  // Aerodrome configuration
  const config = {
    routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
    wethAddress: '0x4200000000000000000000000000000000000006',
  };

  // Initialize quote provider
  const quoteProvider = new AerodromeQuoteProvider(wallet, config);
  const initialized = await quoteProvider.initialize();

  if (!initialized) {
    console.error('Failed to initialize Aerodrome quote provider');
    return;
  }

  console.log('✓ Aerodrome quote provider initialized');

  // Test token pair (WETH/USDC on Base)
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const amountIn = ethers.utils.parseEther('1'); // 1 WETH

  // Check if pool exists
  const poolInfo = await quoteProvider.poolExists(WETH, USDC);
  console.log(`Pool exists: ${poolInfo.exists}`);
  if (poolInfo.exists) {
    console.log(`Pool type: ${poolInfo.isStable ? 'stable' : 'volatile'}`);
    console.log(`Pool address: ${poolInfo.poolAddress}`);
  }

  // Get quote
  const quoteResult = await quoteProvider.getQuote(amountIn, WETH, USDC);
  if (quoteResult.success) {
    console.log('✓ Quote successful');
    console.log(`  Input: 1 WETH`);
    console.log(`  Output: ${ethers.utils.formatUnits(quoteResult.dstAmount!, 6)} USDC`);
    console.log(`  Pool type: ${quoteResult.poolType}`);
  } else {
    console.error(`✗ Quote failed: ${quoteResult.error}`);
  }

  // Get market price
  const priceResult = await quoteProvider.getMarketPrice(
    amountIn,
    WETH,
    USDC,
    18,  // WETH decimals
    6    // USDC decimals
  );

  if (priceResult.success) {
    console.log('✓ Market price calculation successful');
    console.log(`  Price: 1 WETH = ${priceResult.price?.toFixed(2)} USDC`);
  } else {
    console.error(`✗ Price calculation failed: ${priceResult.error}`);
  }
}

testAerodromeQuotes().catch(console.error);
```

#### Run the test:

```bash
npx ts-node test-aerodrome-quotes.ts
```

#### Expected output:

```
✓ Aerodrome quote provider initialized
Pool exists: true
Pool type: volatile
Pool address: 0x...
✓ Quote successful
  Input: 1 WETH
  Output: 3500.00 USDC
  Pool type: volatile
✓ Market price calculation successful
  Price: 1 WETH = 3500.00 USDC
```

### Phase 2: Swap Module Testing (Manual Swap)

Test the swap module directly before integrating with the keeper.

#### Create a Test Script

Create `test-aerodrome-swap.ts`:

```typescript
import { ethers } from 'ethers';
import { swapWithAerodromeRouter } from './src/aerodrome-router-module';

async function testAerodromeSwap() {
  // Setup provider and signer
  const provider = new ethers.providers.JsonRpcProvider(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );

  // Load your keeper wallet (use test wallet with small amounts!)
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  // Test swap parameters
  const WETH = '0x4200000000000000000000000000000000000006';
  const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const amountToSwap = ethers.utils.parseEther('0.01'); // 0.01 WETH (small test amount)
  const slippage = 0.5; // 0.5%

  const routerAddress = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43';
  const factoryAddress = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

  console.log('Testing Aerodrome swap...');
  console.log(`  Swapping: 0.01 WETH → USDC`);
  console.log(`  Router: ${routerAddress}`);

  const result = await swapWithAerodromeRouter(
    wallet,
    WETH,
    amountToSwap,
    USDC,
    slippage,
    routerAddress,
    factoryAddress
  );

  if (result.success) {
    console.log('✓ Swap successful');
    console.log(`  Pool type: ${result.poolType}`);
    console.log(`  Transaction: ${result.receipt?.transactionHash}`);
  } else {
    console.error(`✗ Swap failed: ${result.error}`);
  }
}

testAerodromeSwap().catch(console.error);
```

#### Run the test:

```bash
npx ts-node test-aerodrome-swap.ts
```

**Warning**: This will execute a real swap on mainnet. Use a test wallet with small amounts!

### Phase 3: Keeper Integration Testing (Dry-Run)

Test the full keeper integration in dry-run mode.

#### Step 1: Enable Dry-Run Mode

In your config file:

```typescript
const config: KeeperConfig = {
  dryRun: true,  // IMPORTANT: Keep this enabled for testing
  logLevel: 'debug',
  // ... other settings
};
```

#### Step 2: Run the Keeper

```bash
npm run build
npm run start -- --config example-base-config.ts
```

#### Step 3: Monitor Logs

Watch for Aerodrome-related log messages:

```
[DEBUG] Factory: Getting Aerodrome quote for 0.05 collateral in pool WETH / USDC
[DEBUG] Aerodrome quote success: 0.05 in -> 175.00 out (volatile pool)
[DEBUG] Aerodrome price check: pool=WETH / USDC, auction=3400.0000, market=3500.0000, takeable=3430.0000, profitable=true
[INFO] DryRun - would Factory Take - poolAddress: 0x0b17159f..., borrower: 0x... using 5
```

Key things to verify:
- ✓ Quote provider initializes successfully
- ✓ Pool detection works (finds stable or volatile pool)
- ✓ Price calculations are accurate
- ✓ Profitability checks execute correctly
- ✓ Dry-run messages show correct parameters

### Phase 4: Live Testing (Small Amounts)

Once dry-run testing passes, test with real liquidations.

#### Step 1: Deploy/Verify Smart Contracts

Ensure your keeper smart contracts support `LiquiditySource.AERODROME = 5`:

```solidity
enum LiquiditySource {
    NONE,
    ONEINCH,
    UNISWAPV3,
    SUSHISWAP,
    CURVE,
    AERODROME  // Must be value 5
}
```

Verify the contract has the Aerodrome swap handler implemented.

#### Step 2: Enable Live Mode

Update your config:

```typescript
const config: KeeperConfig = {
  dryRun: false,  // Enable live mode
  logLevel: 'info',  // Reduce log verbosity
  // ... other settings
};
```

#### Step 3: Fund Keeper Wallet

Ensure your keeper wallet has:
- Sufficient Base ETH for gas fees
- No additional token balance required (atomic swaps fund themselves)

#### Step 4: Start Keeper

```bash
npm run start -- --config your-config.ts
```

#### Step 5: Monitor First Take

Watch logs for the first Aerodrome take:

```
[INFO] Factory: Executing Aerodrome take for pool WETH / USDC:
  Router: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
  Factory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da
  Pool Type: volatile
  Pool Address: 0x...
  Collateral (WAD): 50000000000000000 (0.05 WETH)
[INFO] Factory: Sending Aerodrome Take Tx - poolAddress: 0x0b17159f..., borrower: 0x...
[INFO] Transaction confirmed: 0x...
[INFO] Gas used: 350000
[INFO] Factory Aerodrome Take successful - poolAddress: 0x0b17159f..., borrower: 0x..., poolType: volatile
```

### Phase 5: Verification and Monitoring

After successful takes, verify:

#### Transaction Verification

1. **Check transaction on BaseScan**: `https://basescan.org/tx/<tx_hash>`
2. **Verify the swap executed** through Aerodrome router
3. **Confirm collateral was acquired** and debt was repaid

#### Pool Type Verification

For different token pairs, verify the keeper uses the correct pool type:

- **Volatile pools** (WETH/USDC, WETH/cbETH): Should show "volatile" in logs
- **Stable pools** (USDC/DAI): Should show "stable" in logs

#### Performance Monitoring

Monitor key metrics:
- **Gas usage**: Aerodrome swaps should use ~300-500k gas (cheaper than V3)
- **Slippage**: Actual output should be close to quoted output
- **Success rate**: Track successful vs failed takes

## Troubleshooting

### Issue: "No Aerodrome pool found"

**Possible causes:**
- Token pair doesn't have an Aerodrome pool
- Wrong network (Aerodrome is Base-only)
- Incorrect factory address

**Solution:**
- Verify pool exists on Aerodrome.finance
- Check you're connected to Base network
- Verify factory address: `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`

### Issue: "Quote provider not available"

**Possible causes:**
- Router or factory contract not found
- RPC connection issues
- Wrong contract addresses

**Solution:**
- Verify router address: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
- Check RPC endpoint is working
- Test with `curl https://base-mainnet.g.alchemy.com/v2/YOUR_KEY -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`

### Issue: "Insufficient liquidity"

**Possible causes:**
- Pool has low liquidity for the swap size
- Price impact too high
- Pool temporarily imbalanced

**Solution:**
- Reduce `minCollateral` in pool config to target smaller takes
- Check Aerodrome.finance for pool liquidity depth
- Try different token pairs with deeper liquidity

### Issue: "Transaction reverted"

**Possible causes:**
- Slippage too tight
- Price moved during transaction
- Smart contract incompatibility

**Solution:**
- Increase `defaultSlippage` (e.g., from 0.5% to 1%)
- Verify smart contract supports `LiquiditySource.AERODROME = 5`
- Check encoded swap details match contract expectations

### Issue: "Wrong pool type detected"

**Possible causes:**
- Auto-detection selected wrong pool
- Both stable and volatile pools exist

**Solution:**
- Explicitly set `defaultPoolType` in config:
  ```typescript
  aerodromeRouterOverrides: {
    // ...
    defaultPoolType: 'volatile',  // or 'stable'
  }
  ```

## Advanced Configuration

### Pool Type Selection

You can force a specific pool type per token pair:

```typescript
// In pool config
take: {
  liquiditySource: LiquiditySource.AERODROME,
  marketPriceFactor: 0.98,
},
// In global config
aerodromeRouterOverrides: {
  // ...
  defaultPoolType: 'volatile',  // Forces volatile pool usage
}
```

### Slippage Tuning

Adjust slippage based on pool liquidity:

```typescript
aerodromeRouterOverrides: {
  // ...
  defaultSlippage: 1.0,  // 1% for low liquidity pools
}
```

### Multiple Token Pairs

Test with various token pairs to ensure broad compatibility:

- **WETH/USDC** (volatile): High liquidity, good for testing
- **cbETH/WETH** (volatile): Correlated assets, lower price impact
- **USDC/USDbC** (stable): Stableswaps, test stable pool logic

## Performance Benchmarks

Expected performance for Aerodrome swaps:

| Metric | Expected Value | Notes |
|--------|---------------|-------|
| Gas Cost | 300-500k | V2-style is cheaper than V3 |
| Quote Latency | <1s | Direct router call |
| Swap Success Rate | >95% | With proper slippage |
| Price Accuracy | ±0.1% | Compared to spot price |

## Next Steps

After successful testing:

1. **Expand to more pools**: Add more Ajna pools with Aerodrome liquidity
2. **Monitor profitability**: Track keeper profits vs gas costs
3. **Optimize parameters**: Tune `marketPriceFactor` and slippage
4. **Compare DEXes**: Test against Uniswap V3 for best pricing
5. **Automate monitoring**: Set up alerts for failed takes

## Support and Resources

- **Aerodrome Finance**: https://aerodrome.finance
- **Aerodrome Docs**: https://docs.aerodrome.finance
- **Base Docs**: https://docs.base.org
- **Ajna Discord**: For keeper support

## Checklist

Use this checklist for systematic testing:

- [ ] Configure Aerodrome addresses in config file
- [ ] Set up `.env` with required API keys
- [ ] Run Phase 1: Quote provider test (dry-run)
- [ ] Run Phase 2: Manual swap test (small amount)
- [ ] Run Phase 3: Keeper integration test (dry-run)
- [ ] Verify smart contract supports AERODROME liquidity source
- [ ] Fund keeper wallet with gas
- [ ] Run Phase 4: Live test (small liquidations)
- [ ] Monitor first successful take transaction
- [ ] Verify transaction on BaseScan
- [ ] Monitor performance metrics
- [ ] Expand to additional pools
- [ ] Set up ongoing monitoring

Good luck testing your Aerodrome integration!
