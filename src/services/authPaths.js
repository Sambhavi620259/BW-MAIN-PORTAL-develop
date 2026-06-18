/**
 * Paths that must never send Bearer tokens (stale JWT breaks login / OTP flows).
 * Supports both relative API paths (`/verify-otp`) and prefixed axios URLs (`/api/v1.0/verify-otp`).
 */
export const PUBLIC_AUTH_PATHS_LIST = [
  "/login",
  "/verify-otp",
  "/verify-email",
  "/admin/auth/login",
  "/admin/auth/verify-otp",
  "/register",
  "/forgot-password",
  "/reset-password",
];

const PUBLIC_AUTH_PATHS = new Set(PUBLIC_AUTH_PATHS_LIST);

const API_PREFIX = "/api/v1.0";

/**
 * @param {string} url Path or full URL fragment (may include query string or `/api/v1.0` prefix).
 * @returns {string} Normalized path starting with `/`, no query, no trailing slash (except `/`).
 */
export function normalizeAuthPath(url) {
  let p = String(url || "").split("?")[0].trim();
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  const idx = p.indexOf(API_PREFIX);
  if (idx >= 0) {
    p = p.slice(idx + API_PREFIX.length);
  }
  if (!p.startsWith("/")) {
    p = `/${p}`;
  }
  return p;
}

export function isPublicAuthPath(url) {
  const p = normalizeAuthPath(url);
  if (PUBLIC_AUTH_PATHS.has(p)) return true;
  // Public admin invite acceptance (no Bearer — invited user has no session yet).
  if (p === "/admin/invite/complete") return true;
  if (/^\/admin\/invite\/[^/]+$/.test(p)) {
    const segment = p.split("/").pop();
    if (segment !== "request-otp" && segment !== "verify-otp") return true;
  }
  return false;
}

/**
 * API paths where **401 must not** trigger global session teardown via `apiFetch` / axios.
 * Used for optional features that may be misconfigured, role-gated, or absent on the server
 * while core auth (`/profile`, etc.) still succeeds with the same JWT.
 */
export function isSessionSoft401Path(url) {
  const p = normalizeAuthPath(url);
  return p === "/notifications" || p.startsWith("/notifications/");
}

/** Any URL fragment that targets verify-otp (belt-and-suspenders for 401 / redirect rules). */
export function urlIncludesVerifyOtp(url) {
  return String(url || "").toLowerCase().includes("verify-otp");
}

const AUTH_UI_PATH_RE =
  /^\/(login|forgot-password|reset-password|verify-email|register|admin\/invite\/[^/]+)(\/|$)/i;

export function isAuthFlowAppPath(pathname) {
  return AUTH_UI_PATH_RE.test(String(pathname || ""));
}
