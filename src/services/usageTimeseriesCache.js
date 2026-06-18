const DEFAULT_TTL_MS = 120_000;
const MAX_ENTRIES = 20;

/**
 * LRU-ish usage timeseries cache: TTL per entry + hard cap on number of keys.
 */
export function createUsageTimeseriesCache({
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = MAX_ENTRIES,
} = {}) {
  /** @type {Map<string, { at: number, rows: unknown[] }>} */
  const map = new Map();

  function touchAsNewest(key, entry) {
    map.delete(key);
    map.set(key, entry);
  }

  function prune() {
    while (map.size > maxEntries) {
      const first = map.keys().next().value;
      if (first === undefined) break;
      map.delete(first);
    }
  }

  return {
    /**
     * @param {string} key
     * @returns {unknown[] | null}
     */
    get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() - entry.at > ttlMs) {
        map.delete(key);
        return null;
      }
      touchAsNewest(key, entry);
      return entry.rows;
    },

    /**
     * @param {string} key
     * @param {unknown[]} rows
     */
    set(key, rows) {
      touchAsNewest(key, { at: Date.now(), rows });
      prune();
    },

    clear() {
      map.clear();
    },
  };
}

/** Shared cache so AuthContext can clear it on login/logout (account switch). */
const globalUsageTimeseriesCache = createUsageTimeseriesCache();

export function getUsageTimeseriesCache() {
  return globalUsageTimeseriesCache;
}

export function invalidateUsageTimeseriesCache() {
  globalUsageTimeseriesCache.clear();
}
