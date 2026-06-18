import { getApiOrigin } from "../services/apiConfig";

/** First path segment after `/uploads/` — all supported static asset roots. */
const UPLOADS_SEGMENT_RE =
  /^(apps|app|kyc|documents|document|profile|profiles|avatars|logos|banners|images)(\/|$)/i;

/** Relative path prefixes stored without leading `uploads/`. */
const RELATIVE_UPLOAD_PREFIX_RE =
  /^(kyc|documents|document|profile|profiles|avatars|apps|app|logos|banners|images)\//i;

const UUID_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i;

/** Backend placeholders that are known to 404/500 — skip fetch and use letter fallback. */
export function isUnusableMediaUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.toLowerCase() === "null") return true;
  const low = raw.toLowerCase();
  if (low.includes("/images/default-app")) return true;
  if (low.endsWith("default-app.png")) return true;
  return false;
}

function isImageFilename(segment) {
  const s = String(segment || "").trim();
  return Boolean(s && /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(s));
}

function isLikelyProfilePhotoFile(segment) {
  const s = String(segment || "").trim();
  if (!s) return false;
  if (/^(profile|profiles|avatars)\//i.test(s)) return true;
  if (/^(kyc|documents|document)\//i.test(s)) return false;
  if (UUID_FILE_RE.test(s)) return true;
  return isImageFilename(s) && !s.includes("/");
}

function isLikelyKycDocumentFile(segment) {
  const s = String(segment || "").trim();
  if (!s) return false;
  if (/^(kyc|documents|document)\//i.test(s)) return true;
  if (/\.pdf$/i.test(s)) return true;
  if (UUID_FILE_RE.test(s)) return true;
  return isImageFilename(s) && !s.includes("/");
}

function isLikelyAppMediaFile(segment) {
  const s = String(segment || "").trim();
  if (!s) return false;
  if (/^(apps|app|logos|banners)\//i.test(s)) return true;
  return false;
}

/**
 * Collapse duplicate `/uploads/uploads/` and trim whitespace.
 * @param {string} raw
 */
export function dedupeUploadsPath(raw) {
  let s = dedupeEmbeddedOrigin(raw);
  if (!s) return "";
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\/uploads\/uploads\//gi, "/uploads/");
  }
  return s;
}

/** Profile-only: collapse duplicated `/uploads/profile/...` segments from legacy payloads. */
function dedupeProfileUploadsPath(raw) {
  let s = dedupeUploadsPath(raw);
  if (!s) return "";
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\/uploads\/profile\/uploads\/profile\//gi, "/uploads/profile/");
    s = s.replace(/\/uploads\/profiles\/uploads\/profiles\//gi, "/uploads/profiles/");
    s = s.replace(/\/uploads\/avatars\/uploads\/avatars\//gi, "/uploads/avatars/");
  }
  return s;
}

function hasCanonicalProfileUploadsPath(pathname) {
  return /\/uploads\/(?:profile|profiles|avatars)\/[^/?#]+/i.test(
    String(pathname || ""),
  );
}

/** Absolute URL already includes `/uploads/profile/{file}` — do not re-prefix origin or path. */
function isAbsoluteCanonicalProfilePhotoUrl(raw) {
  if (!/^(https?:|data:|blob:)/i.test(raw)) return false;
  try {
    const u = new URL(dedupeEmbeddedOrigin(raw));
    return hasCanonicalProfileUploadsPath(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Fix backend URLs with duplicated origin, e.g.
 * `http://hosthttp://host/uploads/...` → `http://host/uploads/...`
 */
export function dedupeEmbeddedOrigin(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(https?:\/\/[^/]+)/i);
  if (!m) return s;
  const origin = m[1];
  while (s.startsWith(origin + origin)) {
    s = origin + s.slice(origin.length * 2);
  }
  const glued = s.match(/^(https?:\/\/[^/]+)(https?:\/\/[^/]+)/i);
  if (glued && glued[1] === glued[2]) {
    s = glued[1] + s.slice(glued[1].length + glued[2].length);
  }
  return s;
}

function stripApiPrefix(pathname) {
  let p = String(pathname || "");
  if (p.startsWith("/api/v1.0/")) p = p.slice("/api/v1.0".length);
  return p.startsWith("/") ? p : `/${p}`;
}

/**
 * Build `{origin}/uploads/...` without duplicating the uploads segment.
 * @param {string} origin
 * @param {string} relativePath path after uploads/ (e.g. `documents/foo.png`)
 */
function joinUploadsUrl(origin, relativePath) {
  const rel = String(relativePath || "")
    .replace(/^\/+/, "")
    .replace(/^uploads\//i, "");
  if (!rel) return "";
  return `${origin.replace(/\/$/, "")}/uploads/${rel}`;
}

/**
 * Rewrite same-origin URLs missing `/uploads/{segment}/` (profile, documents, apps).
 * Preserves existing `/uploads/kyc/*` and `/uploads/documents/*` paths.
 */
function rewriteMisplacedApiOriginUrl(url, { profile = false, kycDocument = false } = {}) {
  const origin = getApiOrigin();
  if (!origin || !url) return url;

  let href = dedupeUploadsPath(url);
  if (LOCALHOST_ORIGIN_RE.test(href) && origin && !LOCALHOST_ORIGIN_RE.test(origin)) {
    try {
      const u = new URL(href);
      const o = new URL(origin);
      href = `${o.origin}${u.pathname}${u.search}${u.hash}`;
    } catch {
      /* keep */
    }
  }

  try {
    const u = new URL(href);
    const o = new URL(origin);
    if (u.origin !== o.origin) return href;

    const pathname = stripApiPrefix(u.pathname);
    if (pathname.startsWith("/uploads/")) return href;

    const segments = pathname.split("/").filter(Boolean);
    const file = segments[segments.length - 1] || "";
    if (!file) return href;

    let subdir = "";
    if (profile || isLikelyProfilePhotoFile(file)) {
      subdir = "profile";
    } else if (kycDocument || isLikelyKycDocumentFile(file)) {
      subdir = "documents";
    } else if (isLikelyAppMediaFile(file) || segments.includes("apps")) {
      subdir = segments.length > 1 ? segments.slice(0, -1).join("/") : "apps";
    }

    const path = subdir ? `/uploads/${subdir}/${file}` : `/uploads/${file}`;
    return `${o.origin}${path}${u.search}${u.hash}`;
  } catch {
    return href;
  }
}

function resolveRelativeUploadPath(relative) {
  const ORIGIN = getApiOrigin();
  if (!ORIGIN) return "";

  const rel = String(relative || "").replace(/^\/+/, "");
  if (!rel) return "";

  if (UPLOADS_SEGMENT_RE.test(rel)) {
    return joinUploadsUrl(ORIGIN, rel);
  }

  if (isLikelyProfilePhotoFile(rel)) {
    return joinUploadsUrl(ORIGIN, `profile/${rel}`);
  }

  return joinUploadsUrl(ORIGIN, rel);
}

/**
 * Resolve backend upload paths to absolute URLs for `<img src>`.
 * Supports `/uploads/apps/*`, `/uploads/profile/*`, `/uploads/kyc/*`, `/uploads/documents/*`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function resolveUploadsUrl(value) {
  let raw = dedupeUploadsPath(String(value ?? "").trim());
  if (!raw || isUnusableMediaUrl(raw)) return "";

  if (/^(https?:|data:|blob:)/i.test(raw)) {
    return rewriteMisplacedApiOriginUrl(raw, { profile: false, kycDocument: false });
  }

  const ORIGIN = getApiOrigin();
  if (!ORIGIN) return "";

  if (raw.startsWith("/uploads/")) return `${ORIGIN}${raw}`;
  if (raw.startsWith("uploads/")) return `${ORIGIN}/${raw}`;

  const relative = raw.startsWith("/") ? raw.slice(1) : raw;

  if (RELATIVE_UPLOAD_PREFIX_RE.test(relative)) {
    return joinUploadsUrl(ORIGIN, relative);
  }

  if (raw.startsWith("/")) {
    const segment = raw.slice(1);
    if (isLikelyProfilePhotoFile(segment)) {
      return joinUploadsUrl(ORIGIN, `profile/${segment}`);
    }
    if (isLikelyKycDocumentFile(segment)) {
      return joinUploadsUrl(ORIGIN, `documents/${segment}`);
    }
    return `${ORIGIN}${raw}`;
  }

  if (raw.includes("/")) {
    return `${ORIGIN}/${relative}`;
  }

  return joinUploadsUrl(ORIGIN, raw);
}

/** True when URL targets a private S3 object (not yet presigned). */
export function isPrivateS3DocumentUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  if (isPresignedS3Url(raw)) return false;
  return /\.s3\.[a-z0-9-]+\.amazonaws\.com\//i.test(raw);
}

/** Any S3 KYC object URL (private or presigned). */
export function isS3KycDocumentUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  return /\.s3\.[a-z0-9-]+\.amazonaws\.com\//i.test(raw);
}

/** AWS SigV4 presigned GET URLs include these query params. */
export function isPresignedS3Url(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return (
      u.searchParams.has("X-Amz-Signature") ||
      u.searchParams.has("X-Amz-Algorithm") ||
      /[?&]X-Amz-Signature=/i.test(raw)
    );
  } catch {
    return /[?&]X-Amz-Signature=/i.test(raw);
  }
}

/**
 * KYC / identity documents — canonical: `/uploads/documents/{file}`.
 * Legacy `/uploads/kyc/*` paths are passed through unchanged.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function resolveKycDocumentUrl(value) {
  let raw = dedupeUploadsPath(String(value ?? "").trim());
  if (!raw || isUnusableMediaUrl(raw)) return "";

  if (/^(https?:|data:|blob:)/i.test(raw)) {
    if (isS3KycDocumentUrl(raw)) return "";

    const rewritten = rewriteMisplacedApiOriginUrl(raw, {
      profile: false,
      kycDocument: true,
    });
    if (/\/uploads\/kyc\//i.test(rewritten)) return rewritten;
    if (/\/uploads\/documents\//i.test(rewritten)) return rewritten;
    return rewritten;
  }

  const ORIGIN = getApiOrigin();
  if (!ORIGIN) return "";

  if (/^\/uploads\/kyc\//i.test(raw)) return `${ORIGIN}${raw}`;
  if (/^uploads\/kyc\//i.test(raw)) return `${ORIGIN}/${raw}`;
  if (/^\/uploads\/documents\//i.test(raw)) return `${ORIGIN}${raw}`;
  if (/^uploads\/documents\//i.test(raw)) return `${ORIGIN}/${raw}`;

  if (raw.startsWith("/uploads/")) {
    const rest = raw.slice("/uploads/".length);
    if (/^kyc\//i.test(rest)) return joinUploadsUrl(ORIGIN, rest);
    if (/^documents\//i.test(rest)) return joinUploadsUrl(ORIGIN, rest);
    return joinUploadsUrl(ORIGIN, `documents/${rest.replace(/^\//, "")}`);
  }

  const relative = raw.startsWith("/") ? raw.slice(1) : raw;

  if (/^kyc\//i.test(relative)) {
    return joinUploadsUrl(ORIGIN, relative);
  }
  if (/^documents\//i.test(relative)) {
    return joinUploadsUrl(ORIGIN, relative);
  }
  if (/^document\//i.test(relative)) {
    return joinUploadsUrl(ORIGIN, `documents/${relative.slice("document/".length)}`);
  }

  if (raw.startsWith("/")) {
    return joinUploadsUrl(ORIGIN, `documents/${raw.slice(1)}`);
  }

  if (relative.includes("/")) {
    return resolveUploadsUrl(raw);
  }

  return joinUploadsUrl(ORIGIN, `documents/${relative}`);
}

/**
 * Profile avatars — canonical: `{origin}/uploads/profile/{file}` (absolute from API).
 * Legacy: bare filename, root-level uuid.png, localhost, relative paths.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function resolveProfilePhotoUrl(value) {
  let raw = dedupeProfileUploadsPath(String(value ?? "").trim());
  if (!raw || isUnusableMediaUrl(raw)) return "";

  if (/^(https?:|data:|blob:)/i.test(raw)) {
    const href = dedupeEmbeddedOrigin(raw);
    if (isAbsoluteCanonicalProfilePhotoUrl(href)) {
      const origin = getApiOrigin();
      if (
        origin &&
        LOCALHOST_ORIGIN_RE.test(href) &&
        !LOCALHOST_ORIGIN_RE.test(origin)
      ) {
        return rewriteMisplacedApiOriginUrl(href, {
          profile: true,
          kycDocument: false,
        });
      }
      return href;
    }
    return rewriteMisplacedApiOriginUrl(href, { profile: true, kycDocument: false });
  }

  const ORIGIN = getApiOrigin();

  if (/^\/uploads\/profile\//i.test(raw)) {
    return ORIGIN ? `${ORIGIN}${raw}` : raw;
  }
  if (/^uploads\/profile\//i.test(raw)) {
    return ORIGIN ? `${ORIGIN}/${raw}` : `/${raw}`;
  }

  if (raw.startsWith("/uploads/")) {
    const rest = raw.slice("/uploads/".length);
    if (/^(profile|profiles|avatars)\//i.test(rest)) {
      return ORIGIN ? joinUploadsUrl(ORIGIN, rest) : `/uploads/${rest}`;
    }
    const file = rest.replace(/^\//, "");
    return ORIGIN
      ? joinUploadsUrl(ORIGIN, `profile/${file}`)
      : `/uploads/profile/${file}`;
  }

  const relative = raw.startsWith("/") ? raw.slice(1) : raw;
  if (/^(profile|profiles|avatars)\//i.test(relative)) {
    return ORIGIN ? joinUploadsUrl(ORIGIN, relative) : `/uploads/${relative}`;
  }

  if (raw.startsWith("/")) {
    const segment = raw.slice(1);
    return ORIGIN
      ? joinUploadsUrl(ORIGIN, `profile/${segment}`)
      : `/uploads/profile/${segment}`;
  }

  if (relative.includes("/")) {
    return ORIGIN
      ? joinUploadsUrl(ORIGIN, `profile/${relative}`)
      : `/uploads/profile/${relative}`;
  }

  return ORIGIN
    ? joinUploadsUrl(ORIGIN, `profile/${relative}`)
    : `/uploads/profile/${relative}`;
}

/** Pick photo path/URL from profile or upload API payloads. */
export function extractProfilePhotoFromPayload(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload.trim();
  if (typeof payload !== "object") return "";

  const nodes = [payload];
  if (payload.data && typeof payload.data === "object") nodes.push(payload.data);
  if (payload.profile && typeof payload.profile === "object") nodes.push(payload.profile);

  const keys = [
    "profilePhotoUrl",
    "photoUrl",
    "photoPath",
    "photo",
    "avatarUrl",
    "imageUrl",
    "url",
    "path",
    "filePath",
  ];

  for (const node of nodes) {
    for (const key of keys) {
      const v = String(node[key] ?? "").trim();
      if (v && v !== "null") return v;
    }
  }
  return "";
}

/** Alias for catalog/admin/user surfaces. */
export const resolveMediaUrl = resolveUploadsUrl;

/** @deprecated prefer resolveUploadsUrl — kept for adminApps imports */
export function resolveAppMediaUrl(url) {
  return resolveUploadsUrl(url);
}
