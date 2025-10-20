import subgraph, {
  PoolSnapshot,
  GetPoolsSnapshotOptions,
} from './subgraph';

const CACHE_TTL_MS = 5_000;

type CacheEntry = {
  snapshot: PoolSnapshot;
  expiry: number;
};

const snapshotCache = new Map<string, CacheEntry>();
let inFlight: Promise<void> | null = null;

function normalizeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const address of addresses) {
    const lower = address.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      normalized.push(lower);
    }
  }
  return normalized;
}

async function fetchSnapshots(
  subgraphUrl: string,
  addresses: string[],
  options?: GetPoolsSnapshotOptions
): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    const snapshots = await subgraph.getPoolsSnapshot(
      subgraphUrl,
      addresses,
      options
    );
    const expiry = Date.now() + CACHE_TTL_MS;
    for (const snapshot of snapshots) {
      snapshotCache.set(snapshot.id.toLowerCase(), {
        snapshot,
        expiry,
      });
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function getPoolSnapshotsCached(
  subgraphUrl: string,
  poolAddresses: string[],
  options?: GetPoolsSnapshotOptions
): Promise<Map<string, PoolSnapshot>> {
  const normalized = normalizeAddresses(poolAddresses);
  if (normalized.length === 0) {
    return new Map();
  }

  while (true) {
    const now = Date.now();
    const needsRefresh = normalized.some((address) => {
      const entry = snapshotCache.get(address);
      return !entry || entry.expiry < now;
    });

    if (!needsRefresh) {
      break;
    }

    await fetchSnapshots(subgraphUrl, normalized, options);
  }

  const result = new Map<string, PoolSnapshot>();
  for (const address of normalized) {
    const entry = snapshotCache.get(address);
    if (entry) {
      result.set(address, entry.snapshot);
    }
  }
  return result;
}

export function clearPoolSnapshotCache(): void {
  snapshotCache.clear();
  inFlight = null;
}
