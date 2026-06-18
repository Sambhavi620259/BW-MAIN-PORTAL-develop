/** Short-lived cache for GET /dashboard/recent-apps (same session, aligned with dashboard bundle TTL). */
const TTL_MS = 45_000;

let store = {
  /** @type {string} */
  key: "",
  /** @type {number} */
  at: 0,
  /** @type {unknown} */
  payload: null,
};

function tokenKey(token) {
  if (!token || typeof token !== "string") return "";
  const t = token.trim();
  return `${t.length}:${t.slice(0, 12)}`;
}

/**
 * @returns {unknown | null} unwrapped recent-apps response body, or null if miss/expired/wrong user
 */
export function readRecentAppsCache(token) {
  const k = tokenKey(token);
  if (!k || store.payload == null) return null;
  if (store.key !== k) return null;
  if (Date.now() - store.at > TTL_MS) return null;
  return store.payload;
}

/** @param {unknown} payload — raw JSON body from `getRecentApps` */
export function writeRecentAppsCache(token, payload) {
  const k = tokenKey(token);
  if (!k) return;
  store = { key: k, at: Date.now(), payload };
}

export function invalidateRecentAppsCache() {
  store.payload = null;
}
