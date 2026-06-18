/**
 * JWT utilities — decode payload for UI hints only.
 * No signature verification; never trust these values for security decisions.
 */

/**
 * Decode a JWT payload without verifying the signature.
 * Returns null for empty, malformed, or non-JWT tokens.
 * @param {string} token
 * @returns {object|null}
 */
export function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    if (pad) base64 += "=".repeat(4 - pad);
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * True when the JWT `exp` claim is in the past.
 * Returns false (safe default) for missing, malformed, or non-expiring tokens.
 * Includes a 10-second clock-skew buffer.
 * @param {string} token
 * @returns {boolean}
 */
export function isJwtExpired(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return false;
  return Date.now() / 1000 > payload.exp - 10;
}
