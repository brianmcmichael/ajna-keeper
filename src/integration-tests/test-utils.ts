import { HARDHAT_RPC_URL, MAINNET_CONFIG } from './test-config';
import { delay } from '../utils';
import { JsonRpcProvider } from '../provider';
import { NonceTracker } from '../nonce';
import { KeeperConfig } from '../config-types';

const BASE_TEST_KEEPER_CONFIG: KeeperConfig = {
  ethRpcUrl: HARDHAT_RPC_URL,
  logLevel: 'debug',
  subgraphUrl: '',
  keeperKeystore: '/tmp/test-keeper-keystore.json',
  ajna: MAINNET_CONFIG.AJNA_CONFIG,
  pools: [],
  delayBetweenActions: 0,
  delayBetweenRuns: 0,
  dryRun: false,
  coinGeckoApiKey: '',
  oneInchRouters: {},
  tokenAddresses: {},
  connectorTokens: [],
};

export function createTestKeeperConfig(
  overrides: Partial<KeeperConfig> = {}
): KeeperConfig {
  return {
    ...BASE_TEST_KEEPER_CONFIG,
    ...overrides,
  };
}

export function makeConfigPick<K extends keyof KeeperConfig>(
  keys: readonly K[],
  overrides: Partial<Pick<KeeperConfig, K>> = {},
  base: KeeperConfig = createTestKeeperConfig()
): Pick<KeeperConfig, K> {
  const picked = {} as Pick<KeeperConfig, K>;
  for (const key of keys) {
    (picked as any)[key] = base[key];
  }
  return Object.assign(picked, overrides);
}

export const getProvider = () => new JsonRpcProvider(HARDHAT_RPC_URL);

export const resetHardhat = async () => {
  await getProvider().send('hardhat_reset', [
    {
      forking: {
        jsonRpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
        blockNumber: MAINNET_CONFIG.BLOCK_NUMBER,
      },
    },
  ]);
  NonceTracker.clearNonces();
};

export const setBalance = (address: string, balance: string) =>
  getProvider().send('hardhat_setBalance', [address, balance]);

export const getBalance = (address: string) =>
  getProvider().send('eth_getBalance', [address]);

export const impersonateAccount = (address: string) =>
  getProvider().send('hardhat_impersonateAccount', [address]);

export const impersonateSigner = async (address: string) => {
  await impersonateAccount(address);
  const provider = getProvider();
  return provider.getSigner(address);
};

export const mine = () => getProvider().send('evm_mine', []);

export const latestBlockTimestamp = async () => {
  const latestBlock = await getProvider().send('eth_getBlockByNumber', [
    'latest',
    false,
  ]);
  return parseInt(latestBlock.timestamp, 16);
};

export const increaseTime = async (seconds: number) => {
  const provider = getProvider();
  const currTimestamp = await latestBlockTimestamp();
  const nextTimestamp = (currTimestamp + seconds).toString();
  await getProvider().send('evm_setNextBlockTimestamp', [nextTimestamp]);
  await mine();
  return await latestBlockTimestamp();
};
