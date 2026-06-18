/** Short-lived cache so revisiting /dashboard avoids redundant bundle calls (same session). */
const TTL_MS = 45_000;

let store = {
  /** @type {string} */
  key: "",
  /** @type {number} */
  at: 0,
  /** @type {PromiseSettledResult<any>[] | null} */
  results: null,
};

function tokenKey(token) {
  if (!token || typeof token !== "string") return "";
  const t = token.trim();
  return `${t.length}:${t.slice(0, 12)}`;
}

/**
 * @returns {PromiseSettledResult<any>[] | null}
 */
export function readDashboardBundleCache(token) {
  const k = tokenKey(token);
  if (!k || !store.results) return null;
  if (store.key !== k) return null;
  if (Date.now() - store.at > TTL_MS) return null;
  return store.results;
}

/** Only stores successful all-four responses so cached payload is consistent. */
export function writeDashboardBundleCacheIfComplete(token, results) {
  const k = tokenKey(token);
  if (!k || !Array.isArray(results) || results.length !== 4) return;
  if (!results.every((r) => r.status === "fulfilled")) return;
  store = { key: k, at: Date.now(), results };
}

export function invalidateDashboardBundleCache() {
  store.results = null;
}
