/**
 * Shared rules for opening catalog apps from user surfaces (dashboard, All Apps, Home, My Apps).
 * Priority: valid `externalUrl` → new tab; else `routePath` / legacy in-app path → SPA `navigate`;
 * else legacy absolute http(s) `appUrl`.
 */

export function isPublishedForUser(row) {
  const raw = row?.status ?? row?.appStatus;
  const st = String(raw ?? "")
    .trim()
    .toUpperCase();
  const low = String(raw ?? "").toLowerCase();
  if (low === "active" || low === "published" || low === "live") return true;
  if (low === "draft" || low === "archived" || low === "suspended" || low === "disabled" || low === "unpublished") {
    return false;
  }
  if (["PUBLISHED", "ACTIVE", "LIVE", "ENABLED"].includes(st)) return true;
  if (["DRAFT", "ARCHIVED", "SUSPENDED", "DISABLED", "UNPUBLISHED"].includes(st)) return false;
  return true;
}

export function validateRoutePath(v) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true };
  if (!s.startsWith("/")) return { ok: false, message: "Internal route must start with /." };
  if (s.includes("//") || s.length < 2) return { ok: false, message: "Invalid internal route." };
  return { ok: true };
}

export function validateExternalUrl(v) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true };
  if (!/^https?:\/\//i.test(s)) return { ok: false, message: "External URL must start with http:// or https://." };
  try {
    // eslint-disable-next-line no-new
    new URL(s);
    return { ok: true };
  } catch {
    return { ok: false, message: "Invalid external URL." };
  }
}

/**
 * @returns {{ kind: "external", href: string } | { kind: "internal", path: string } | { kind: "none" }}
 */
export function resolveUserAppOpenTarget(row) {
  const ext = String(row?.externalUrl ?? "").trim();
  const route = String(row?.routePath ?? row?.route ?? "").trim();
  const legacy = String(row?.appUrl ?? row?.url ?? "").trim();

  if (ext) {
    const extVal = validateExternalUrl(ext);
    if (extVal.ok) return { kind: "external", href: ext };
  }
  if (route) {
    const path = route.startsWith("/") ? route : `/${route}`;
    const chk = validateRoutePath(path);
    if (chk.ok) return { kind: "internal", path };
  }
  if (legacy && /^https?:\/\//i.test(legacy)) {
    const extVal = validateExternalUrl(legacy);
    if (extVal.ok) return { kind: "external", href: legacy };
  }
  if (legacy && legacy.startsWith("/")) {
    const chk = validateRoutePath(legacy);
    if (chk.ok) return { kind: "internal", path: legacy };
  }
  if (legacy && !legacy.startsWith("http")) {
    const path = legacy.startsWith("/") ? legacy : `/${legacy.replace(/^\.\//, "")}`;
    const chk = validateRoutePath(path);
    if (chk.ok) return { kind: "internal", path };
  }
  return { kind: "none" };
}

/**
 * @param {object} row
 * @param {{ navigate: (path: string) => void, applicationBackend?: { open?: (id: unknown) => Promise<unknown> }, allowUnpublished?: boolean, onAfterOpen?: () => void }} opts
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function openUserCatalogApp(row, opts) {
  const { navigate, applicationBackend, allowUnpublished = false, onAfterOpen } = opts || {};
  const appId = row?.appId ?? row?.id;

  if (!allowUnpublished && !isPublishedForUser(row)) {
    return { ok: false, reason: "unpublished" };
  }

  const target = resolveUserAppOpenTarget(row);
  if (target.kind === "none") {
    return { ok: false, reason: "no-target" };
  }

  const fireOpenTrack = () => {
    if (appId != null && applicationBackend?.open) {
      Promise.resolve(applicationBackend.open(appId))
        .catch(() => {})
        .finally(() => onAfterOpen?.());
      return;
    }
    onAfterOpen?.();
  };

  if (target.kind === "external") {
    window.open(target.href, "_blank", "noopener,noreferrer");
    fireOpenTrack();
    return { ok: true };
  }

  fireOpenTrack();
  navigate(target.path);
  return { ok: true };
}

/** Stable Set key for subscription ownership (numeric id → number, else string). */
export function appSubscriptionIdKey(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") {
    const nested =
      value.appId ??
      value.id ??
      value.applicationId ??
      value.app?.appId ??
      value.app?.id;
    return appSubscriptionIdKey(nested);
  }
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const s = String(value).trim();
  return s || null;
}

/** Build a Set of subscribed app ids from `/application/my` (or legacy) rows. */
export function collectMyAppIdSet(rows) {
  const set = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = appSubscriptionIdKey(row);
    if (key != null) set.add(key);
  });
  return set;
}

export function isAppSubscribed(myAppIds, appId) {
  const key = appSubscriptionIdKey(appId);
  return key != null && myAppIds instanceof Set && myAppIds.has(key);
}

/** Immutable Set with one subscription id removed. */
export function withoutMyAppId(prevSet, appId) {
  const key = appSubscriptionIdKey(appId);
  if (key == null || !(prevSet instanceof Set)) return prevSet;
  const next = new Set(prevSet);
  next.delete(key);
  return next;
}

/** All Apps catalog: hide non–public apps unless the user already subscribed. */
export function isAppVisibleOnAllAppsPage(
  app,
  myAppIds = new Set()
) {

  if (!app) {

    return false;
  }

  // show all published apps

  if (!isPublishedForUser(app)) {

    return false;
  }

  return true;
}
