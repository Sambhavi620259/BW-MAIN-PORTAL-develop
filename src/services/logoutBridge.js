/**
 * logoutBridge.js
 *
 * Lightweight logout-handler registry for the native-fetch transport (apiFetch.js).
 *
 * Design goals:
 *   - Zero imports → no circular-dependency risk.
 *   - Single source of truth for the registered logout callback.
 *   - `forceLogoutClient` is the only place localStorage auth keys are cleared
 *     by the transport layer; AuthContext registers itself via `setLogoutHandler`.
 */

const TOKEN_KEY = "ui-access-token";
const PROFILE_CACHE_KEY = "ui-profile";

/** @type {(() => void) | null} */
let _logoutHandler = null;

/**
 * Register the application logout function so 401 interceptors can call it.
 * Must be called once from AuthContext (or the top-level auth provider).
 * @param {() => void} fn
 */
export function setLogoutHandler(fn) {
  _logoutHandler = fn;
}

/**
 * Full client logout for 401 responses from the fetch transport.
 * Clears storage keys used by AuthContext, then invokes the registered handler.
 */
export function forceLogoutClient() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem("userId");
  window.localStorage.removeItem(PROFILE_CACHE_KEY);
  if (typeof _logoutHandler === "function") {
    _logoutHandler();
  }
}
