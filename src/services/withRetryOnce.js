/**
 * Runs an async function once; on failure, runs it one more time before surfacing the error.
 * @param {object} [options]
 * @param {() => void} [options.onRetrying] — called immediately before the second attempt (for UX).
 */
export async function withRetryOnce(fn, options = {}) {
  const { onRetrying } = options || {};
  try {
    return await fn();
  } catch (firstErr) {
    if (typeof onRetrying === "function") {
      onRetrying();
    }
    return await fn();
  }
}
