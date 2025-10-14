import 'dotenv/config';
import { getPriceCoinGecko } from './src/coingecko';
import { PriceOriginSource } from './src/config-types';

async function testPriceFallback() {
  const chainId = 8453; // Base
  const rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  const coinGeckoApiKey = process.env.COINGECKO_API_KEY;

  console.log('Testing Price Fallback System (CoinGecko → Alchemy)...\n');

  try {
    // Test 1: WETH - Should use Alchemy as fallback (or CoinGecko if key provided)
    console.log('Test 1: Fetching WETH price...');
    const wethPrice = await getPriceCoinGecko(
      {
        source: PriceOriginSource.COINGECKO,
        query: 'price?ids=ethereum&vs_currencies=usd',
      },
      coinGeckoApiKey,
      chainId,
      rpcUrl,
      { ethereum: '0x4200000000000000000000000000000000000006' }
    );
    console.log(`✓ WETH Price: $${wethPrice.toFixed(2)}`);
    console.log(`  (Used: ${coinGeckoApiKey && coinGeckoApiKey !== 'YOUR_COINGECKO_API_KEY_HERE' ? 'CoinGecko' : 'Alchemy fallback'})\n`);

    // Test 2: CANA - Will try CoinGecko first, then Alchemy (but CANA not in Alchemy)
    console.log('Test 2: Fetching CANA price...');
    try {
      const canaPrice = await getPriceCoinGecko(
        {
          source: PriceOriginSource.COINGECKO,
          query: 'price?ids=cana-holdings-california-carbon-credits&vs_currencies=usd',
        },
        coinGeckoApiKey,
        chainId,
        rpcUrl,
        {
          'cana-holdings-california-carbon-credits': '0x88a3548e2a662936268bFD4366e48D38183E3958',
          'cana': '0x88a3548e2a662936268bFD4366e48D38183E3958'
        }
      );
      console.log(`✓ CANA Price: $${canaPrice.toFixed(6)}`);
      console.log(`  (Used: CoinGecko - CANA not available in Alchemy)\n`);
    } catch (error) {
      console.log(`❌ CANA price failed: ${error}`);
      console.log(`  You need a CoinGecko API key for CANA!\n`);
      throw error;
    }

    // Test 3: USDC - Test with well-known stablecoin
    console.log('Test 3: Fetching USDC price...');
    const usdcPrice = await getPriceCoinGecko(
      {
        source: PriceOriginSource.COINGECKO,
        query: 'price?ids=usd-coin&vs_currencies=usd',
      },
      coinGeckoApiKey,
      chainId,
      rpcUrl,
      { 'usd-coin': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }
    );
    console.log(`✓ USDC Price: $${usdcPrice.toFixed(4)}\n`);

    console.log('✅ All price fallback tests passed!');
    console.log('\n📊 Summary:');
    console.log('  - Well-known tokens (WETH, USDC): Available in both CoinGecko and Alchemy');
    console.log('  - Smaller tokens (CANA): Only available in CoinGecko');
    console.log('  - Fallback system: CoinGecko (if key provided) → Alchemy → Error');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testPriceFallback();
