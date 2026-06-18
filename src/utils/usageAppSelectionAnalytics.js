/**
 * Lightweight local analytics for “which app is picked most” on the dashboard
 * (no network; safe to extend later to real telemetry).
 */
const STORAGE_KEY = "bw_usage_app_pick_counts_v1";
const MAX_KEYS = 80;

export function recordDashboardUsageAppPick(appId) {
  if (appId === undefined || appId === null || String(appId).trim() === "") return;
  const k = String(appId).trim();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    let obj = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed;
      } catch {
        obj = {};
      }
    }
    obj[k] = (Number(obj[k]) || 0) + 1;
    const keys = Object.keys(obj);
    if (keys.length > MAX_KEYS) {
      const sorted = keys.sort((a, b) => (Number(obj[b]) || 0) - (Number(obj[a]) || 0));
      const next = {};
      sorted.slice(0, MAX_KEYS).forEach((id) => {
        next[id] = obj[id];
      });
      obj = next;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* private mode / quota */
  }
}
