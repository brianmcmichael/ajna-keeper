import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import * as path from 'path';
import { password } from '@inquirer/prompts';
import 'dotenv/config';

const AJNA_FACTORY = '0x214f62B5836D83f3D6c4f71F174209097B1A779C'; // Base

async function main() {
  console.log('🚀 Deploying 1inch Keeper Taker on Base\n');

  // Load keystore
  const keystorePath = '/home/bmc/.ethereum/keystore/UTC--2025-08-06T00-22-38.739183935Z--ccadea5cc24204995a98daa056c37bd5207fd0c5';
  const keystoreJson = readFileSync(keystorePath, 'utf8');

  const pswd = await password({
    message: 'Please enter your keystore password',
    mask: '*',
  });

  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, pswd);
  console.log('👤 Loaded wallet:', wallet.address);

  // Connect to provider
  const provider = new ethers.providers.JsonRpcProvider(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
  );
  const signer = wallet.connect(provider);

  const balance = await signer.getBalance();
  console.log('💰 Account balance:', ethers.utils.formatEther(balance), 'ETH\n');

  if (balance.lt(ethers.utils.parseEther('0.001'))) {
    console.error('⚠️  WARNING: Low balance. You may need more ETH.');
  }

  // Load contract artifact
  const artifactPath = path.join(
    __dirname,
    'artifacts',
    'contracts',
    'AjnaKeeperTaker.sol',
    'AjnaKeeperTaker.json'
  );

  let artifact;
  try {
    artifact = require(artifactPath);
  } catch (error) {
    console.error('❌ Contract artifact not found. Run: yarn compile');
    process.exit(1);
  }

  // Create contract factory
  const AjnaKeeperTaker = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer
  );

  console.log('📦 Deploying AjnaKeeperTaker (1inch)...');
  console.log('   Ajna Factory:', AJNA_FACTORY);

  // Deploy with Base-appropriate gas settings
  const taker = await AjnaKeeperTaker.deploy(AJNA_FACTORY, {
    gasLimit: 3000000,
    gasPrice: ethers.utils.parseUnits('1', 'gwei'),
  });

  console.log('✅ Deployment tx:', taker.deployTransaction.hash);
  console.log('⏳ Waiting for confirmation...');

  await taker.deployed();

  console.log('🎉 AjnaKeeperTaker deployed to:', taker.address);
  console.log('\n📝 Update your base-config.ts:');
  console.log('```typescript');
  console.log(`keeperTaker: '${taker.address}',`);
  console.log('```');
  console.log('\n✅ Deployment complete!');
  console.log('\n🔍 View on BaseScan:');
  console.log(`https://basescan.org/address/${taker.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
