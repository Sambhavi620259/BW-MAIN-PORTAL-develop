import { normalizeKycStoredUrlForAccess } from "./kycDocumentAccess";
import {
  isPresignedS3Url,
  isPrivateS3DocumentUrl,
  isS3KycDocumentUrl,
  resolveKycDocumentUrl,
} from "./mediaUrl";

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s && s !== "null" && s !== "undefined" ? s : "";
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = safeStr(v);
    if (s) return s;
  }
  return "";
}

/**
 * Ordered KYC document fields (backend Authify contract + legacy aliases).
 * First match wins for primary selection; all unique URLs become preview candidates.
 */
export const KYC_DOCUMENT_FIELD_SPECS = [
  { key: "aadhaarFrontUrl", aliases: ["aadhaar_front_url"], label: "Aadhaar (front)" },
  { key: "aadhaarBackUrl", aliases: ["aadhaar_back_url"], label: "Aadhaar (back)" },
  {
    key: "panCardUrl",
    aliases: ["pan_url", "panImageUrl", "panDocumentUrl", "panFrontUrl"],
    label: "PAN card",
  },
  {
    key: "passportUrl",
    aliases: ["passportImageUrl", "passportFrontUrl"],
    label: "Passport",
  },
  {
    key: "drivingLicenseUrl",
    aliases: ["dlUrl", "drivingLicenceUrl", "licenseFrontUrl"],
    label: "Driving licence",
  },
  {
    key: "frontDocumentUrl",
    aliases: [
      "frontUrl",
      "documentFrontUrl",
      "idFrontUrl",
      "frontImageUrl",
      "documentFront",
      "document_front",
    ],
    label: "Front document",
  },
  {
    key: "backDocumentUrl",
    aliases: [
      "backUrl",
      "documentBackUrl",
      "idBackUrl",
      "backImageUrl",
      "documentBack",
      "document_back",
    ],
    label: "Back document",
  },
  {
    key: "selfieUrl",
    aliases: ["selfieImageUrl", "faceUrl", "portraitUrl"],
    label: "Selfie",
  },
  {
    key: "livePhotoUrl",
    aliases: ["live_photo_url", "livePhoto", "livenessImageUrl", "livenessUrl"],
    label: "Live photo",
  },
  { key: "documentUrl", aliases: ["document_url"], label: "Document" },
  { key: "documentFile", aliases: ["document_file"], label: "Document file" },
  {
    key: "filePath",
    aliases: [
      "file_path",
      "documentPath",
      "document_path",
      "imageUrl",
      "image_url",
      "file_url",
      "previewUrl",
      "preview_url",
    ],
    label: "Uploaded file",
  },
];

/** All keys persisted when merging admin KYC detail rows. */
export const KYC_DOCUMENT_URL_KEYS = KYC_DOCUMENT_FIELD_SPECS.map((s) => s.key);

/**
 * Generic URL catch-all fields that accumulate "whatever was uploaded" and may
 * contain stale uploads from an earlier session. Specific typed fields take
 * priority in admin preview; these are only used when no typed field is present.
 */
export const KYC_GENERIC_FALLBACK_KEYS = new Set(["documentUrl", "documentFile", "filePath"]);

/**
 * Matches the stale-word as a distinct token when surrounded by filename separators
 * (hyphen, underscore, dot, space) or start/end of the filename string.
 * Avoids false positives on filenames like "latest.jpg", "protest.pdf", "contest.jpg".
 */

const STALE_FILENAME_WORDS = new Set(["test", "sample", "placeholder", "demo", "dummy"]);

/**
 * True when the URL's filename looks like a test/demo/placeholder asset that
 * should never appear in admin document previews.
 * Only inspects the filename segment (before the query string).
 * @param {string} url
 * @returns {boolean}
 */
export function isStaleTestAssetUrl(url) {
  const s = safeStr(url);
  if (!s) return false;
  const withoutQuery = s.split("?")[0];
  const filename = withoutQuery.split("/").pop() || "";
  // Strip file extension, split on common filename separators, and check each token.
  const name = filename.replace(/\.[^.]*$/, "").toLowerCase();
  return name.split(/[-_.\s]+/).some((token) => STALE_FILENAME_WORDS.has(token));
}

/**
 * @param {object} record
 * @returns {object[]}
 */
export function collectKycSourceNodes(record) {
  if (!record || typeof record !== "object") return [];
  const r = record;
  const raw = r._raw && typeof r._raw === "object" ? r._raw : null;
  /** @type {object[]} */
  const nodes = [];

  const push = (node) => {
    if (node && typeof node === "object" && !nodes.includes(node)) nodes.push(node);
  };

  if (raw) {
    push(raw);
    push(raw.profile);
    push(raw.kyc);
    push(raw.user);
    push(raw.user?.profile);
    push(raw.applicant);
    push(raw.applicantInfo);
    push(raw.application);
    push(raw.kycApplication);
  }

  push(r);
  push(r.profile);
  push(r.kyc);
  push(r.user);
  push(r.user?.profile);
  push(r.applicant);
  push(r.applicantInfo);
  push(r.application);
  push(r.kycApplication);

  return nodes;
}

function pickFieldFromNodes(nodes, key, aliases = []) {
  const keys = [key, ...aliases];
  for (const node of nodes) {
    for (const k of keys) {
      const s = safeStr(node[k]);
      if (s) return s;
    }
  }
  return "";
}

function dedupeStoredUrlKey(storedUrl) {
  const canonical = normalizeKycStoredUrlForAccess(storedUrl);
  return canonical || safeStr(storedUrl);
}

/** @param {string} storedUrl */
export function isPlausibleKycDocumentStoredUrl(storedUrl) {
  const s = safeStr(storedUrl);
  if (!s) return false;

  // Explicitly reject dangerous or unsupported protocols
  if (/^(?:[a-z0-9.+-]+:|\/\/)/i.test(s) && !/^https?:\/\//i.test(s)) {
    return false;
  }

  if (isS3KycDocumentUrl(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^\/uploads\//i.test(s)) return true;
  if (/^uploads\//i.test(s)) return true;
  if (/^(kyc|documents|document)\//i.test(s)) return true;
  return s.includes("/") || /\.(pdf|png|jpe?g|webp|gif)$/i.test(s);
}

/** @param {string} storedUrl */
export function kycDocumentKind(storedUrl) {
  const s = safeStr(storedUrl).toLowerCase();
  if (!s) return "image";
  if (s.includes(".pdf")) return "pdf";
  if (s.includes("content-type=application%2Fpdf")) return "pdf";
  if (s.includes("type=application/pdf")) return "pdf";
  return "image";
}

/**
 * @param {string} storedUrl raw backend value
 * @returns {{ storedUrl: string, previewSafeUrl: string, needsSecureAccess: boolean, kind: "image"|"pdf" }}
 */
export function resolveKycDocumentAccessShape(storedUrl) {
  const raw = safeStr(storedUrl);
  const needsSecureAccess = isPrivateS3DocumentUrl(raw);
  const previewSafeUrl = isPresignedS3Url(raw)
    ? raw
    : needsSecureAccess
      ? ""
      : resolveKycDocumentUrl(raw);
  return {
    storedUrl: raw,
    previewSafeUrl,
    needsSecureAccess,
    kind: kycDocumentKind(raw),
  };
}

/**
 * Central resolver — raw storage URLs preserved; S3 flagged for document-access.
 *
 * @param {object} record KYC row, profile.kyc, or API envelope fragment
 * @returns {Array<{ key: string, label: string, storedUrl: string, previewSafeUrl: string, needsSecureAccess: boolean, kind: "image"|"pdf" }>}
 */
export function resolveKycDocumentCandidates(record) {
  const nodes = collectKycSourceNodes(record);
  /** @type {ReturnType<typeof resolveKycDocumentCandidates>} */
  const out = [];
  const seen = new Set();

  for (const spec of KYC_DOCUMENT_FIELD_SPECS) {
    const storedUrl = pickFieldFromNodes(nodes, spec.key, spec.aliases);
    if (!isPlausibleKycDocumentStoredUrl(storedUrl)) continue;

    const dedupe = dedupeStoredUrlKey(storedUrl);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const shape = resolveKycDocumentAccessShape(storedUrl);
    if (!shape.needsSecureAccess && !shape.previewSafeUrl) continue;

    out.push({
      key: spec.key,
      label: spec.label,
      ...shape,
    });
  }

  return out;
}

/** @param {object} record */
export function hasKycDocumentCandidates(record) {
  return resolveKycDocumentCandidates(record).length > 0;
}

/**
 * Normalize a URL for dedup comparison: strip query string, trim, lowercase.
 * Handles presigned S3 URLs (same object, different X-Amz-Signature / expiry),
 * CDN URLs with cache-busters, and any incidental query params.
 * The original URL is always preserved for actual requests — this is for keying only.
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrlForDedup(url) {
  const s = safeStr(url);
  if (!s) return "";
  return s.split("?")[0].trim().toLowerCase();
}

/** Primary stored URL for user profile download/preview. */
export function pickPrimaryKycDocumentStoredUrl(record) {
  const nodes = collectKycSourceNodes(record);
  const effectiveFrontDocUrl = pickFieldFromNodes(
    nodes,
    "frontDocumentUrl",
    ["frontUrl", "documentFrontUrl", "idFrontUrl", "frontImageUrl", "documentFront", "document_front"]
  );
  const effectiveAadhaarFrontUrl = pickFieldFromNodes(
    nodes,
    "aadhaarFrontUrl",
    ["aadhaar_front_url"]
  );

  const isReupload =
    Boolean(effectiveFrontDocUrl) &&
    Boolean(effectiveAadhaarFrontUrl) &&
    normalizeUrlForDedup(effectiveFrontDocUrl) !== normalizeUrlForDedup(effectiveAadhaarFrontUrl);

  if (isReupload) {
    return effectiveFrontDocUrl;
  }

  return resolveKycDocumentCandidates(record)[0]?.storedUrl || "";
}

/** @param {object} record */
export function pickPrimaryKycDocumentCandidate(record) {
  const primaryUrl = pickPrimaryKycDocumentStoredUrl(record);
  if (!primaryUrl) return null;
  const candidates = resolveKycDocumentCandidates(record);
  return candidates.find((c) => c.storedUrl === primaryUrl) || null;
}

