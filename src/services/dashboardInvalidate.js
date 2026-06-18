import { invalidateDashboardBundleCache } from "./dashboardBundleCache";
import { invalidateRecentAppsCache } from "./recentAppsCache";

/** Dispatched when dashboard bundle cache should be cleared and `/dashboard` should refetch if mounted. */
export const DASHBOARD_INVALIDATE_EVENT = "bw:dashboard-cache-invalidate";

/** Coalesce rapid invalidations into a single refetch (listeners still get fresh data; cache is cleared immediately). */
const INVALIDATE_DISPATCH_DEBOUNCE_MS = 400;

let _invalidateDispatchTimer = null;

/**
 * Clears a pending debounced refetch dispatch (e.g. on logout/login so no stray refresh runs).
 */
export function cancelDebouncedDashboardInvalidate() {
  if (_invalidateDispatchTimer != null) {
    clearTimeout(_invalidateDispatchTimer);
    _invalidateDispatchTimer = null;
  }
}

/**
 * Clears the in-memory dashboard bundle cache and notifies listeners (e.g. UserDashboard)
 * to reload with `force: true` so KPI / transactions / activity stay aligned after mutations.
 * Cache invalidation is immediate; the window event is debounced to avoid burst refetches.
 *
 * @param {string} [reason] — optional for debugging
 */
export function invalidateDashboardData(reason = "") {
  invalidateDashboardBundleCache();
  invalidateRecentAppsCache();
  if (typeof window === "undefined") return;

  if (_invalidateDispatchTimer != null) {
    clearTimeout(_invalidateDispatchTimer);
  }
  _invalidateDispatchTimer = setTimeout(() => {
    _invalidateDispatchTimer = null;
    window.dispatchEvent(
      new CustomEvent(DASHBOARD_INVALIDATE_EVENT, {
        detail: { reason },
      }),
    );
  }, INVALIDATE_DISPATCH_DEBOUNCE_MS);
}
