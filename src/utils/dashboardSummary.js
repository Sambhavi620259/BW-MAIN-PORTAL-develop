import { peelRepeatedApiEnvelope } from "./apiEnvelope";

const IS_DEV = import.meta.env.DEV;

/** Aliases for global published/public catalog count (NOT user subscriptions). */
export const CATALOG_APP_COUNT_ALIASES = [
  "publishedAppsCount",
  "catalogAppsCount",
  "globalAppsCount",
  "publicAppsCount",
  "totalPublishedApps",
  "publishedAppCount",
  "catalogAppCount",
  "allAppsCount",
  "totalCatalogApps",
];

/** Aliases for user ticket KPI count on dashboard summary. */
export const TICKET_COUNT_ALIASES = [
  "openTickets",
  "ticketCount",
  "myTickets",
  "totalTickets",
  "myTicketsCount",
  "ticketsCount",
  "supportTicketsCount",
  "activeTickets",
];

function toFiniteNumber(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (cleaned === "") return fallback;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function collectSummaryInspectionLayers(raw) {
  const peeled = peelRepeatedApiEnvelope(raw);
  if (peeled == null || typeof peeled !== "object" || Array.isArray(peeled)) return [];
  /** @type {object[]} */
  const layers = [];
  let node = peeled;
  for (let i = 0; i < 5; i += 1) {
    if (!node || typeof node !== "object" || Array.isArray(node)) break;
    layers.push(node);
    for (const sk of ["statsSummary", "stats", "summary"]) {
      const sub = node[sk];
      if (sub && typeof sub === "object" && !Array.isArray(sub)) layers.push(sub);
    }
    const inner = node.data;
    if (inner == null || typeof inner !== "object" || Array.isArray(inner)) break;
    node = inner;
  }
  return layers;
}

function pickFirstPresent(layers, keys) {
  for (const key of keys) {
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (!layer || typeof layer !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(layer, key)) continue;
      const v = layer[key];
      if (v === undefined || v === null || v === "") continue;
      return { value: v, key, layerIndex: i };
    }
  }
  return { value: undefined, key: "", layerIndex: -1 };
}

function pickBestPositiveCount(layers, keys) {
  for (const key of keys) {
    for (let i = 0; i < layers.length; i += 1) {
      const layer = layers[i];
      if (!layer || typeof layer !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(layer, key)) continue;
      const v = layer[key];
      if (v === undefined || v === null || v === "") continue;
      const n = toFiniteNumber(v, NaN);
      if (Number.isFinite(n) && n > 0) return { value: n, key, layerIndex: i };
    }
  }
  const hit = pickFirstPresent(layers, keys);
  const n = toFiniteNumber(hit.value, NaN);
  return {
    value: Number.isFinite(n) ? n : 0,
    key: hit.key,
    layerIndex: hit.layerIndex,
  };
}

/**
 * Derive catalog total from `applicationBackend.list()` response metadata.
 * @param {unknown} catalogListRes
 */
export function catalogCountFromListResponse(catalogListRes) {
  if (catalogListRes == null) return 0;
  if (Array.isArray(catalogListRes)) return catalogListRes.length;
  const peeled = peelRepeatedApiEnvelope(catalogListRes);
  if (Array.isArray(peeled)) return peeled.length;
  if (peeled && typeof peeled === "object") {
    const data = /** @type {Record<string, unknown>} */ (peeled);
    const fromMeta =
      toFiniteNumber(
        data.totalElements ?? data.total ?? data.count ?? data.totalItems,
        0,
      ) || 0;
    if (fromMeta > 0) return fromMeta;
    if (Array.isArray(data.content)) return data.content.length;
  }
  return 0;
}

/**
 * Normalize user dashboard summary KPIs with catalog-first app count.
 *
 * @param {unknown} raw — GET /dashboard body (post-envelope or raw)
 * @param {{ catalogFromList?: number }} [options]
 */
export function dashboardSummaryNormalize(raw, options = {}) {
  const layers = collectSummaryInspectionLayers(raw);
  const catalogHit = pickBestPositiveCount(layers, CATALOG_APP_COUNT_ALIASES);
  const totalAppsHit = pickFirstPresent(layers, ["totalApps"]);
  const catalogFromList = toFiniteNumber(options.catalogFromList, 0);

  let totalApps = 0;
  let totalAppsSource = "none";
  if (catalogFromList > 0) {
    totalApps = catalogFromList;
    totalAppsSource = "catalogFromList";
  } else if (catalogHit.value > 0) {
    totalApps = catalogHit.value;
    totalAppsSource = `layers[${catalogHit.layerIndex}].${catalogHit.key}`;
  } else {
    const fallback = toFiniteNumber(totalAppsHit.value, 0);
    totalApps = fallback;
    totalAppsSource =
      totalAppsHit.layerIndex >= 0
        ? `layers[${totalAppsHit.layerIndex}].totalApps (fallback)`
        : "none";
  }

  const subsHit = pickFirstPresent(layers, [
    "activeSubscriptions",
    "subscriptionCount",
    "subscribedAppsCount",
  ]);
  const ticketHit = pickFirstPresent(layers, TICKET_COUNT_ALIASES);
  const ticketCountRaw = toFiniteNumber(ticketHit.value, NaN);
  const txnHit = pickFirstPresent(layers, ["totalTransactions", "transactionCount"]);
  const referralHit = pickFirstPresent(layers, ["referralCount", "referrals"]);
  const spentHit = pickFirstPresent(layers, ["totalSpent", "spent"]);
  const kycHit = pickFirstPresent(layers, ["kycStatus", "kyc"]);

  const normalized = {
    totalApps,
    activeSubscriptions: toFiniteNumber(subsHit.value, 0),
    ...(Number.isFinite(ticketCountRaw)
      ? { ticketCount: ticketCountRaw, openTickets: ticketCountRaw }
      : {}),
    totalTransactions: toFiniteNumber(txnHit.value, 0),
    referralCount: toFiniteNumber(referralHit.value, 0),
    totalSpent: toFiniteNumber(spentHit.value, 0),
    kycStatus: String(kycHit.value ?? "PENDING").toUpperCase(),
    catalogAppsCount: totalApps,
    publishedAppsCount: catalogHit.value > 0 ? catalogHit.value : totalApps,
  };

  if (IS_DEV) {
    // eslint-disable-next-line no-console
    console.groupCollapsed("[DASHBOARD_SUMMARY_AUDIT] user");
    // eslint-disable-next-line no-console
    console.log("raw", raw);
    // eslint-disable-next-line no-console
    console.log("layers", layers);
    // eslint-disable-next-line no-console
    console.log("totalApps source", totalAppsSource, "→", totalApps);
    // eslint-disable-next-line no-console
    console.log("normalized", normalized);
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  return normalized;
}
