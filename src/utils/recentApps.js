import { extractApiArrayAndMeta } from "./apiEnvelope";
import { pickAppBannerUrl, pickAppLogoUrl } from "./adminApps";

function parseValidTimestamp(raw) {
  if (raw == null || raw === "") return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * GET /dashboard/recent-apps — only apps the user has opened (not subscribed-only).
 * Rows without a valid open timestamp are excluded.
 *
 * @param {unknown} body
 * @param {{ limit?: number }} [options]
 */
export function normalizeRecentAppsPayload(body, options = {}) {
  const { limit = 6 } = options;
  const { items: raw } = extractApiArrayAndMeta(body);

  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const appId = row.appId ?? row.id ?? row.applicationId;
      if (appId === undefined || appId === null) return null;

      const lastOpenedAt =
        row.lastOpenedAt ?? row.openedAt ?? row.lastAccessAt ?? row.lastOpenAt ?? null;
      const subscribedAt = row.subscribedAt ?? row.subscriptionDate ?? null;
      const openedMs = parseValidTimestamp(lastOpenedAt);

      // Subscribe-only rows (no open timestamp) must not appear as "recent".
      if (openedMs == null) {
        if (subscribedAt && !lastOpenedAt) return null;
        return null;
      }

      const appName = String(row.appName ?? row.name ?? row.title ?? "App").trim() || "App";
      const externalUrl = String(row.externalUrl ?? "").trim();
      const routePath = String(row.routePath ?? row.route ?? "").trim();
      let appUrl = String(row.appUrl ?? row.url ?? "").trim();
      if (!appUrl) {
        if (externalUrl) appUrl = externalUrl;
        else if (routePath) appUrl = routePath.startsWith("/") ? routePath : `/${routePath}`;
      }
      const logoUrl = pickAppLogoUrl(
        row.logoUrl,
        row.appLogo,
        row.iconUrl,
        row.imageUrl,
        row.logo,
        row.resolvedImage,
      );
      const bannerUrl = pickAppBannerUrl(
        row.bannerUrl,
        row.banner,
        row.coverUrl,
        row.cover,
      );
      const status = row.status ?? row.appStatus ?? null;

      return {
        appId,
        appName,
        lastOpenedAt,
        lastOpenedAtMs: openedMs,
        appUrl,
        externalUrl,
        routePath,
        logoUrl,
        bannerUrl,
        status,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.lastOpenedAtMs - a.lastOpenedAtMs)
    .slice(0, limit);
}

/** Subscription rows for usage analytics app picker (not recent-apps). */
export function normalizeMyAppsUsageOptions(body) {
  const { items: raw } = extractApiArrayAndMeta(body);
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const nested = row.app && typeof row.app === "object" ? row.app : null;
      const appId =
        row.appId ?? row.id ?? row.applicationId ?? nested?.appId ?? nested?.id;
      if (appId === undefined || appId === null) return null;
      const label =
        String(
          row.appName ?? row.name ?? nested?.appName ?? nested?.name ?? `App #${appId}`,
        ).trim() || `App #${appId}`;
      const logoUrl = pickAppLogoUrl(
        row.logoUrl,
        row.appLogo,
        row.iconUrl,
        row.imageUrl,
        row.logo,
        row.resolvedImage,
        nested?.logoUrl,
        nested?.appLogo,
        nested?.iconUrl,
        nested?.imageUrl,
        nested?.resolvedImage,
      );
      return { appId: String(appId), label, logoUrl };
    })
    .filter(Boolean);
}
