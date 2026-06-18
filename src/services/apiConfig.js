/**
 * Single source of truth for API origin + `/api/v1.0` prefix.
 *
 * **`VITE_API_URL`** — canonical backend origin (scheme + host + port only, no path).
 * Example: `http://43.205.116.38:8080`
 *
 * **`VITE_API_BASE_URL`** — legacy alias for the same value (optional).
 *
 * | Mode | env set | Behavior |
 * |------|---------|----------|
 * | dev/prod | yes | Direct to env host |
 * | dev/prod | no | Empty origin (set `VITE_API_URL`) or Vite proxy in dev |
 * | dev | `VITE_USE_VITE_PROXY=true` and env unset | Relative `/api/v1.0/...` → Vite proxy |
 */
/** No production default — configure `VITE_API_URL` for every deploy. */
export const DEFAULT_API_ORIGIN = "";

export const API_PREFIX = "/api/v1.0";

function trimOrigin(v) {
  return String(v ?? "")
    .trim()
    .replace(/\/$/, "");
}

/** Read canonical or legacy env keys (Vite inlines at build/dev startup). */
function readApiOriginFromEnv() {
  return trimOrigin(
    import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL,
  );
}

/**
 * Production runtime guard — throws immediately if the build was deployed without
 * `VITE_API_URL` set, preventing silent fallback to same-origin `/api/v1.0/...`.
 * Has no effect in development or test environments.
 */
if (import.meta.env.PROD && !readApiOriginFromEnv()) {
  throw new Error(
    "[BW-PORTAL] VITE_API_URL is required in production. " +
      "Rebuild with VITE_API_URL set to your backend origin (e.g. http://your-server:8080).",
  );
}

export function getApiOrigin() {
  const fromEnv = readApiOriginFromEnv();
  if (fromEnv) return fromEnv;
  if (
    import.meta.env.DEV &&
    import.meta.env.VITE_USE_VITE_PROXY === "true"
  ) {
    return "";
  }
  return DEFAULT_API_ORIGIN;
}

/** `true` only when explicitly opted in — relative URLs + Vite `server.proxy`. */
export function usesViteProxy() {
  return import.meta.env.DEV && import.meta.env.VITE_USE_VITE_PROXY === "true" && !readApiOriginFromEnv();
}

export function getApiBaseRoot() {
  return `${getApiOrigin()}${API_PREFIX}`;
}

/**
 * @param {string} path API path starting with `/`, e.g. `/profile`
 */
export function buildApiRequestUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getApiOrigin()}${API_PREFIX}${p}`;
}

/** Safe preview for DEV logs (never log full JWT). */
export function previewAuthorizationHeader(value) {
  if (value == null || value === "") return "(none)";
  const s = String(value);
  if (!/^Bearer\s+\S+/i.test(s)) return s.length > 80 ? `${s.slice(0, 40)}…` : s;
  const raw = s.replace(/^Bearer\s+/i, "").trim();
  if (raw.length < 24) return `Bearer (${raw.length} chars)`;
  return `Bearer ${raw.slice(0, 12)}…${raw.slice(-8)} (${raw.length} chars)`;
}

/**
 * DEV-only: single-line transport summary (Final URL, Authorization presence, credentials).
 */
export function logDevApiTransport({
  source = "apiFetch",
  finalUrl,
  credentialsMode,
  authorizationHeader,
}) {
  if (!import.meta.env.DEV) return;
  const authPresent = Boolean(
    authorizationHeader && String(authorizationHeader).trim(),
  );
  // eslint-disable-next-line no-console
  console.log(`[API:${source}]`, {
    finalUrl,
    authorizationPresent: authPresent,
    authorizationPreview: previewAuthorizationHeader(authorizationHeader),
    credentials: credentialsMode,
    transport: usesViteProxy() ? "relative+Vite-proxy" : "direct-to-origin",
  });
}

/**
 * DEV only: set `VITE_DEBUG_AUTH_TOKEN=true` in `.env` to log the **full** JWT and exact
 * `Authorization` header (for comparing with Postman/curl). Never ship production builds with this enabled.
 */
export function isAuthTokenDebugEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_DEBUG_AUTH_TOKEN === "true";
}

function trimEnv(value) {
  return String(value ?? "").trim();
}

