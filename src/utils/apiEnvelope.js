/**
 * Peel repeated `{ data: ... }` / success envelopes without losing the outer payload.
 *
 * @param {unknown} raw
 * @param {number} [maxDepth]
 * @returns {unknown}
 */
export function peelRepeatedApiEnvelope(raw, maxDepth = 5) {
  let node = raw;
  for (let i = 0; i < maxDepth; i += 1) {
    if (node == null || typeof node !== "object" || Array.isArray(node)) break;
    const inner = node.data;
    if (inner == null || typeof inner !== "object") break;
    if (Array.isArray(inner)) break;
    const status = node.status ?? node.success;
    const looksLikeEnvelope =
      status !== undefined ||
      node.message !== undefined ||
      node.error !== undefined ||
      Object.prototype.hasOwnProperty.call(node, "data");
    if (!looksLikeEnvelope) break;
    node = inner;
  }
  return node;
}

/**
 * Extract list payload + pagination metadata from common API shapes.
 *
 * @param {unknown} body
 * @returns {{ items: unknown[]; meta: Record<string, unknown> }}
 */
export function extractApiArrayAndMeta(body) {
  const peeled = peelRepeatedApiEnvelope(body);
  if (Array.isArray(peeled)) {
    return { items: peeled, meta: {} };
  }
  if (peeled == null || typeof peeled !== "object") {
    return { items: [], meta: {} };
  }

  const r = /** @type {Record<string, unknown>} */ (peeled);
  const arrayKeys = ["content", "items", "results", "apps", "data", "records", "tickets"];
  for (const key of arrayKeys) {
    if (Array.isArray(r[key])) {
      const { [key]: _items, ...meta } = r;
      return { items: r[key], meta };
    }
  }

  if (Array.isArray(r.points)) return { items: r.points, meta: r };
  if (Array.isArray(r.series)) return { items: r.series, meta: r };
  if (Array.isArray(r.buckets)) return { items: r.buckets, meta: r };

  return { items: [], meta: r };
}
