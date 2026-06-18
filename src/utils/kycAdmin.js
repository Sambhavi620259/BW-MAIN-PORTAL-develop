import {
  KYC_DOCUMENT_URL_KEYS,
  isStaleTestAssetUrl,
  normalizeUrlForDedup,
  pickPrimaryKycDocumentStoredUrl,
  resolveKycDocumentCandidates,
} from "./kycDocumentCandidates";
import {
  isPresignedS3Url,
  isPrivateS3DocumentUrl,
  resolveKycDocumentUrl,
} from "./mediaUrl";

export { hasKycDocumentCandidates, resolveKycDocumentCandidates } from "./kycDocumentCandidates";

/** Canonical workflow values used for filters + stats (uppercase). */
export const KYC_CANONICAL = {
  PENDING: "PENDING",
  UNDER_REVIEW: "UNDER_REVIEW",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  REUPLOAD_REQUIRED: "REUPLOAD_REQUIRED",
};

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s && s !== "null" && s !== "undefined" ? s : "";
}

const KYC_REJECT_HELPER_MARKERS = [
  "sent if api accepts json body",
  "optional, sent if api",
];

/** True when text is admin UI helper copy, not a real rejection reason. */
export function isKycRejectHelperCopy(text) {
  const s = String(text ?? "").trim().toLowerCase();
  if (!s) return false;
  return KYC_REJECT_HELPER_MARKERS.some((m) => s.includes(m));
}

/** Trim and drop helper/placeholder copy so it is never prefilled or submitted. */
export function sanitizeKycRejectReasonInput(text) {
  const s = String(text ?? "").trim();
  if (!s || isKycRejectHelperCopy(s)) return "";
  return s;
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = safeStr(v);
    if (s) return s;
  }
  return "";
}

/** Resolve KYC/document paths (`/uploads/documents/*`, legacy `/uploads/kyc/*`). */
export function absolutizePossibleApiUrl(path) {
  return resolveKycDocumentUrl(safeStr(path));
}

/**
 * Display / correlation user id (e.g. USR-…). Not used as `/kyc/{id}` path param on this backend.
 * @param {object} row
 * @returns {string}
 */
export function resolveKycModerationUserId(row) {
  if (!row || typeof row !== "object") return "";
  const raw = row._raw && typeof row._raw === "object" ? row._raw : {};
  const uid = pickFirst(
    row.userId,
    row.user_id,
    raw.userId,
    raw.user_id,
    row.user?.userId,
    row.user?.user_id,
    row.user?.id,
    raw.user?.userId,
    row.applicant?.userId,
    row.applicantInfo?.userId,
  );
  if (uid) return uid;
  const id = safeStr(row.id);
  if (/^USR[-_]/i.test(id)) return id;
  const rawId = safeStr(raw.id);
  if (/^USR[-_]/i.test(rawId)) return rawId;
  return "";
}

/**
 * Path id for GET/PUT `/kyc/{id}`, `/kyc/verify/{id}`, etc.
 * Backend expects numeric KYC record id (Long), not `USR-*` userId.
 * @param {object} row
 * @returns {string}
 */
export function resolveKycApiPathId(row) {
  if (!row || typeof row !== "object") return "";
  const raw = row._raw && typeof row._raw === "object" ? row._raw : {};
  const candidates = [
    row.kycRecordId,
    row.id,
    row.kycId,
    raw.id,
    raw.kycId,
    raw.kycRecordId,
  ];
  for (const c of candidates) {
    const s = safeStr(c);
    if (/^\d+$/.test(s)) return s;
  }
  const fallback = safeStr(row.id);
  if (fallback && !/^USR[-_]/i.test(fallback) && !/^kyc_\d+$/i.test(fallback)) {
    return fallback;
  }
  return "";
}

/** @deprecated alias — use resolveKycApiPathId */
export function resolveKycDetailLookupId(row) {
  return resolveKycApiPathId(row);
}

/** @deprecated use absolutizePossibleApiUrl — alias */
export const resolveKycMediaUrl = absolutizePossibleApiUrl;

function parseIsoOrDisplay(raw) {
  const s = safeStr(raw);
  if (!s) return "—";
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return s;
    }
  }
  return s;
}

/**
 * Map arbitrary backend / legacy status strings to a canonical workflow bucket.
 */
export function canonicalizeKycStatus(raw) {
  const u = safeStr(raw).toUpperCase().replace(/\s+/g, "_");
  if (!u) return KYC_CANONICAL.PENDING;
  if (u === "VERIFIED" || u === "APPROVED" || u === "COMPLETE" || u === "SUCCESS") return KYC_CANONICAL.VERIFIED;
  if (u === "REJECTED" || u === "DECLINED" || u === "FAILED") return KYC_CANONICAL.REJECTED;
  if (u === "REUPLOAD_REQUIRED" || u === "RESUBMIT_REQUIRED" || u === "NEED_INFO" || u === "NEEDINFO" || u === "ADDITIONAL_INFO")
    return KYC_CANONICAL.REUPLOAD_REQUIRED;
  if (u === "UNDER_REVIEW" || u === "IN_REVIEW" || u === "INREVIEW" || u === "REVIEWING" || u === "SUBMITTED")
    return KYC_CANONICAL.UNDER_REVIEW;
  if (u === "PENDING" || u === "NEW" || u === "DRAFT" || u === "UNVERIFIED") return KYC_CANONICAL.PENDING;
  if (
    u === "NOT_SUBMITTED" ||
    u === "NOTSUBMITTED" ||
    u === "NOT_SUBMITTED_YET" ||
    u === "NONE" ||
    u === "MISSING"
  )
    return KYC_CANONICAL.PENDING;
  return KYC_CANONICAL.UNDER_REVIEW;
}

/** Human label for table badge (title case). */
export function kycCanonicalLabel(canonical) {
  switch (canonical) {
    case KYC_CANONICAL.VERIFIED:
      return "Verified";
    case KYC_CANONICAL.REJECTED:
      return "Rejected";
    case KYC_CANONICAL.REUPLOAD_REQUIRED:
      return "Re-upload required";
    case KYC_CANONICAL.UNDER_REVIEW:
      return "Under review";
    default:
      return "Pending";
  }
}

/** CSS slug for badge / row styling */
export function kycCanonicalSlug(canonical) {
  return String(canonical || KYC_CANONICAL.PENDING)
    .toLowerCase()
    .replace(/_/g, "-");
}

/** Heuristic: treat as PDF when path or query hints at PDF (no fetch of Content-Type). */
export function kycUrlLooksLikePdf(url) {
  const s = safeStr(url).toLowerCase();
  if (!s) return false;
  if (s.includes(".pdf")) return true;
  if (s.includes("content-type=application%2Fpdf")) return true;
  if (s.includes("type=application/pdf")) return true;
  return false;
}

function kycStatusToken(raw) {
  return safeStr(raw).toUpperCase().replace(/\s+/g, "_");
}

function isRejectedDocStatus(status) {
  const u = kycStatusToken(status);
  return (
    u === "REJECTED" ||
    u === "DECLINED" ||
    u === "ARCHIVED" ||
    u === "SUPERSEDED" ||
    u === "REPLACED" ||
    u === "INACTIVE" ||
    u === "OLD"
  );
}

function isActiveDocStatus(status) {
  const u = kycStatusToken(status);
  if (!u) return true;
  return !isRejectedDocStatus(u);
}

function extractEmbeddedDocumentUrl(entry) {
  if (typeof entry === "string") return safeStr(entry);
  if (!entry || typeof entry !== "object") return "";
  return pickFirst(
    entry.url,
    entry.fileUrl,
    entry.downloadUrl,
    entry.path,
    entry.link,
    entry.href,
    entry.filePath,
    entry.documentUrl,
    entry.documentFile,
    entry.document_file,
    entry.imageUrl,
    entry.aadhaarFrontUrl,
    entry.frontDocumentUrl,
    entry.backDocumentUrl,
  );
}

function extractEmbeddedDocumentLabel(entry, index) {
  if (typeof entry === "string") return `Document ${index + 1}`;
  if (!entry || typeof entry !== "object") return `Document ${index + 1}`;
  return (
    pickFirst(
      entry.label,
      entry.type,
      entry.name,
      entry.documentType,
      entry.docType,
    ) || `Document ${index + 1}`
  );
}

function extractEmbeddedDocumentTimestamp(entry, index) {
  if (!entry || typeof entry !== "object") return 0;
  const raw = pickFirst(
    entry.uploadedAt,
    entry.createdAt,
    entry.submittedAt,
    entry.updatedAt,
    entry.timestamp,
    entry.reviewedAt,
  );
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function extractEmbeddedDocumentStatus(entry) {
  if (!entry || typeof entry !== "object") return "";
  return pickFirst(
    entry.status,
    entry.documentStatus,
    entry.state,
    entry.verificationStatus,
    entry.reviewStatus,
  );
}

function collectEmbeddedDocumentEntries(embedded) {
  if (!Array.isArray(embedded)) return [];
  return embedded
    .map((entry, index) => ({
      url: extractEmbeddedDocumentUrl(entry),
      label: extractEmbeddedDocumentLabel(entry, index),
      status: extractEmbeddedDocumentStatus(entry),
      timestamp: extractEmbeddedDocumentTimestamp(entry, index),
      index,
    }))
    .filter((entry) => entry.url);
}

function sortEmbeddedDocumentEntries(entries) {
  const hasTimestamp = entries.some((entry) => entry.timestamp > 0);
  return [...entries].sort((a, b) => {
    if (hasTimestamp) {
      return b.timestamp - a.timestamp || b.index - a.index;
    }
    // Append-only history arrays: last item is usually the newest upload.
    return b.index - a.index;
  });
}

function dedupeDocumentEntriesByUrl(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }
  return out;
}

function resolvePrimaryDocumentUrl(row, raw) {
  const primary = pickPrimaryKycDocumentStoredUrl(
    raw && typeof raw === "object" ? { ...row, _raw: raw } : row,
  );
  if (primary) return primary;
  return pickPrimaryKycDocumentStoredUrl(row);
}

function resolvePreviousRejectedDocumentUrl(row, raw) {
  const nodes = [row, raw].filter((n) => n && typeof n === "object");
  const keys = [
    "previousDocumentUrl",
    "previousFilePath",
    "previousDocumentPath",
    "rejectedDocumentUrl",
    "rejectedFilePath",
    "archivedDocumentUrl",
    "archivedFilePath",
    "priorDocumentUrl",
    "priorFilePath",
  ];
  for (const node of nodes) {
    for (const k of keys) {
      const s = safeStr(node[k]);
      if (s) return s;
    }
  }
  return "";
}

function toPreviewSlot(label, url, idSeed) {
  const stored = safeStr(url);
  if (!stored) return null;
  if (isPresignedS3Url(stored)) {
    return {
      id: `${idSeed}-${label.replace(/\s+/g, "-")}`,
      label,
      storedUrl: stored,
      url: stored,
      needsPresign: false,
      kind: kycUrlLooksLikePdf(stored) ? "pdf" : "image",
    };
  }
  const needsPresign = isPrivateS3DocumentUrl(stored);
  const u = needsPresign ? "" : absolutizePossibleApiUrl(stored);
  if (!needsPresign && !u) return null;
  return {
    id: `${idSeed}-${label.replace(/\s+/g, "-")}`,
    label,
    storedUrl: stored,
    url: u,
    needsPresign,
    kind: kycUrlLooksLikePdf(stored) ? "pdf" : "image",
  };
}

/**
 * User-facing KYC rejection copy (GET /profile, GET /kyc/me).
 * Backend contract priority:
 *   1. profile.kyc.rejectionReason (incl. profile.profile.kyc after partial flatten)
 *   2. kycRejectionReason (top-level on profile payload)
 */
export function pickProfileKycRejectionReason(profile, kyc) {
  const profileObj = profile && typeof profile === "object" ? profile : null;
  const kycObj = kyc && typeof kyc === "object" ? kyc : null;
  const envelopeProfile =
    profileObj?.profile && typeof profileObj.profile === "object"
      ? profileObj.profile
      : null;
  const profileKyc =
    (profileObj?.kyc && typeof profileObj.kyc === "object" ? profileObj.kyc : null) ||
    (envelopeProfile?.kyc && typeof envelopeProfile.kyc === "object"
      ? envelopeProfile.kyc
      : null) ||
    (kycObj?.profile?.kyc && typeof kycObj.profile.kyc === "object"
      ? kycObj.profile.kyc
      : null);

  return pickFirst(
    profileKyc?.rejectionReason,
    profileKyc?.rejection_reason,
    profileObj?.kycRejectionReason,
    profileObj?.kyc_rejection_reason,
    envelopeProfile?.kycRejectionReason,
    envelopeProfile?.kyc?.rejectionReason,
    kycObj?.rejectionReason,
    kycObj?.kycRejectionReason,
    kycObj?.rejection_reason,
  );
}

/** @deprecated alias — use pickProfileKycRejectionReason */
export function resolveUserKycRejectionReason(sources = {}) {
  return pickProfileKycRejectionReason(sources.profile, sources.kyc);
}

/**
 * Normalize `GET /kyc/me` (and profile nested KYC) into a flat user-facing KYC object.
 * Lifts rejection reason from envelope / user nest when backend stores it outside `user.kyc`.
 */
export function normalizeUserKycMePayload(raw) {
  if (!raw || typeof raw !== "object") return null;

  const profileBlock =
    raw.profile && typeof raw.profile === "object" ? raw.profile : null;
  const profileKyc =
    profileBlock?.kyc && typeof profileBlock.kyc === "object"
      ? profileBlock.kyc
      : null;
  const user = raw.user && typeof raw.user === "object" ? raw.user : null;
  const nestedKyc =
    profileKyc ??
    (user?.kyc && typeof user.kyc === "object" ? user.kyc : null) ??
    (raw.kyc && typeof raw.kyc === "object" ? raw.kyc : null);

  const base = nestedKyc ? { ...nestedKyc } : { ...raw };
  const rejectionReason = pickFirst(
    profileKyc?.rejectionReason,
    raw.kycRejectionReason,
    profileBlock?.kycRejectionReason,
    nestedKyc?.rejectionReason,
    user?.kyc?.rejectionReason,
    raw.rejectionReason,
  );

  const status = pickFirst(
    base.status,
    raw.kycStatus,
    profileKyc?.status,
    profileBlock?.kycStatus,
    raw.status,
    user?.kycStatus,
    user?.kyc?.status,
  );

  return {
    ...base,
    ...(status ? { status } : {}),
    ...(rejectionReason
      ? {
          rejectionReason,
          kycRejectionReason: rejectionReason,
        }
      : {}),
  };
}


/**
 * Admin-preview field priority — differs from the global KYC_DOCUMENT_FIELD_SPECS order.
 *
 * This backend writes the current resubmission into frontDocumentUrl / backDocumentUrl
 * on every KYC reupload. The typed Aadhaar fields (aadhaarFrontUrl / aadhaarBackUrl)
 * retain the ORIGINAL first upload and must be treated as "previous submission" context.
 *
 * By listing frontDocumentUrl / backDocumentUrl FIRST, the current document always
 * occupies slot 1. The typed Aadhaar fields can only appear as slot 2 (previous).
 */
const ADMIN_PREVIEW_KEY_PRIORITY = new Map(
  [
    "frontDocumentUrl",
    "backDocumentUrl",
    "panCardUrl",
    "passportUrl",
    "drivingLicenseUrl",
    "aadhaarFrontUrl",
    "aadhaarBackUrl",
    "selfieUrl",
    "livePhotoUrl",
    "documentUrl",
    "documentFile",
    "filePath",
  ].map((k, i) => [k, i]),
);

/**
 * Ordered document slots for admin preview — shows current document and, when
 * applicable, the immediately previous submission only (max 2 cards total).
 * @param {ReturnType<typeof normalizeAdminKycRow> | object} row
 * @returns {{ id: string, label: string, url: string, needsPresign: boolean, kind: "image"|"pdf" }[]}
 */
export function getAdminKycDocumentPreviewSlots(row) {
  if (!row || typeof row !== "object") return [];

  const raw = row._raw && typeof row._raw === "object" ? row._raw : null;
  const embedded =
    row.documents ||
    row.kycDocuments ||
    row.kycDocumentUrls ||
    (raw && (raw.documents || raw.kycDocuments || raw.kycDocumentUrls));

  const fieldCandidates = resolveKycDocumentCandidates(row);
  const sortedEntries = dedupeDocumentEntriesByUrl(
    sortEmbeddedDocumentEntries(collectEmbeddedDocumentEntries(embedded)),
  );

  const canonicalStatus = canonicalizeKycStatus(
    row.canonicalStatus || row.statusRaw || row.status || raw?.status,
  );
  const allowPreviousRejected =
    canonicalStatus === KYC_CANONICAL.REJECTED ||
    canonicalStatus === KYC_CANONICAL.REUPLOAD_REQUIRED;

  /** @type {{ id: string, label: string, url: string, needsPresign: boolean, kind: "image"|"pdf" }[]} */
  const out = [];

  if (fieldCandidates.length) {
    // Re-sort by admin-preview priority so frontDocumentUrl (current resubmission)
    // comes before aadhaarFrontUrl (original typed field, potentially stale).
    const sorted = [...fieldCandidates].sort(
      (a, b) =>
        (ADMIN_PREVIEW_KEY_PRIORITY.get(a.key) ?? 99) -
        (ADMIN_PREVIEW_KEY_PRIORITY.get(b.key) ?? 99),
    );

    // Remove test/demo/placeholder assets that should never appear in admin previews.
    const staleFiltered = sorted.filter((c) => !isStaleTestAssetUrl(c.storedUrl));

    /**
     * Second-pass dedup by normalized base URL (strip query string, lowercase).
     *
     * resolveKycDocumentCandidates already dedupes by canonical path for S3 URLs,
     * but may miss non-S3 / CDN URLs with differing query strings, and presigned
     * URLs for the same object generated at different times (different X-Amz-Signature
     * values). This pass catches all remaining duplicates uniformly.
     */
    const seen = new Set();
    const unique = [];
    for (const c of staleFiltered) {
      const normKey = normalizeUrlForDedup(c.storedUrl);
      if (!normKey || seen.has(normKey)) continue;
      seen.add(normKey);
      unique.push(c);
    }

    /**
     * Reupload detection: the backend explicitly populates both frontDocumentUrl
     * (current resubmission) AND aadhaarFrontUrl (original upload) with DIFFERENT
     * URLs when a user reuploads. In that case:
     *   - slot 1 is always shown (current document)
     *   - slot 2 (original/previous) is only shown when the admin is actively
     *     reviewing a rejection or reupload-required case (allowPreviousRejected).
     *
     * When isReupload is false (original submission or both fields share the same URL),
     * both slots are always shown — e.g., front + back sides of the current document.
     */
    const effectiveFrontDocUrl =
      safeStr(row.frontDocumentUrl) || safeStr(raw?.frontDocumentUrl);
    const effectiveAadhaarFrontUrl =
      safeStr(row.aadhaarFrontUrl) || safeStr(raw?.aadhaarFrontUrl);
    const isReupload =
      Boolean(effectiveFrontDocUrl) &&
      Boolean(effectiveAadhaarFrontUrl) &&
      normalizeUrlForDedup(effectiveFrontDocUrl) !== normalizeUrlForDedup(effectiveAadhaarFrontUrl);

    const maxSlots = isReupload && !allowPreviousRejected ? 1 : 2;

    for (const candidate of unique.slice(0, maxSlots)) {
      const slot = toPreviewSlot(candidate.label, candidate.storedUrl, candidate.key);
      if (slot) out.push(slot);
    }
    // Always return from the field-candidates branch — even when out is empty.
    // Prevents stale-filtered URLs from reappearing through the primary-URL
    // fallback below (resolvePrimaryDocumentUrl re-reads the same fields).
    return out;
  }

  if (sortedEntries.length) {
    const latestActive =
      sortedEntries.find((entry) => isActiveDocStatus(entry.status)) || sortedEntries[0];
    const latestSlot = toPreviewSlot("Current document", latestActive.url, "current");
    if (latestSlot) out.push(latestSlot);

    if (allowPreviousRejected) {
      const previousRejectedEntry =
        sortedEntries.find(
          (entry) =>
            entry.url !== latestActive.url && isRejectedDocStatus(entry.status),
        ) ||
        (sortedEntries.length > 1 && sortedEntries[1].url !== latestActive.url
          ? sortedEntries[1]
          : null);
      const previousRejectedUrl =
        previousRejectedEntry?.url || resolvePreviousRejectedDocumentUrl(row, raw);
      if (previousRejectedUrl && previousRejectedUrl !== latestActive.url) {
        const previousSlot = toPreviewSlot(
          "Previous submission (rejected)",
          previousRejectedUrl,
          "previous",
        );
        if (previousSlot) out.push(previousSlot);
      }
    }

    return out.slice(0, 2);
  }

  const primaryUrl = resolvePrimaryDocumentUrl(row, raw);
  const primarySlot = toPreviewSlot("Current document", primaryUrl, "current");
  if (primarySlot) out.push(primarySlot);

  if (allowPreviousRejected) {
    const previousUrl = resolvePreviousRejectedDocumentUrl(row, raw);
    if (previousUrl && previousUrl !== primaryUrl) {
      const previousSlot = toPreviewSlot(
        "Previous submission (rejected)",
        previousUrl,
        "previous",
      );
      if (previousSlot) out.push(previousSlot);
    }
  }

  return out.slice(0, 2);
}

const DEV_KYC_DETAIL_AUDIT =
  import.meta.env.DEV && import.meta.env.VITE_KYC_DETAIL_AUDIT !== "false";

function auditKycDetail(label, payload) {
  if (!DEV_KYC_DETAIL_AUDIT) return;
  const meta =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { keys: Object.keys(payload) }
      : { type: Array.isArray(payload) ? "array" : typeof payload };
  // eslint-disable-next-line no-console
  console.debug(`[kyc-detail] ${label}`, meta);
}

function pickKycRecordFromArray(arr, matchId, matchKycId = "", matchUserId = "") {
  if (!Array.isArray(arr) || !arr.length) return null;
  const ids = [safeStr(matchId), safeStr(matchKycId), safeStr(matchUserId)].filter(Boolean);
  if (ids.length) {
    const hit = arr.find((item) => {
      if (!item || typeof item !== "object") return false;
      const candidates = [
        item.id,
        item.kycId,
        item.requestId,
        item.applicationId,
        item.userId,
        item.user_id,
      ];
      return candidates.some((c) => ids.includes(safeStr(c)));
    });
    if (hit) return hit;
  }
  const first = arr.find((item) => item && typeof item === "object");
  return first ?? null;
}

/**
 * Unwrap `GET /admin/kyc/{id}` (and variants) to a single KYC record.
 * Handles `{ success, data: [ {...} ] }`, `{ data: {...} }`, raw array, or plain object.
 *
 * @param {unknown} detail
 * @param {{ matchId?: string }} [options]
 * @returns {object|null}
 */
export function unwrapKycDetailRecord(detail, options = {}) {
  const { matchId, matchKycId, matchUserId } = options;
  if (detail == null) return null;

  if (Array.isArray(detail)) {
    return pickKycRecordFromArray(detail, matchId, matchKycId, matchUserId);
  }

  if (typeof detail !== "object") return null;

  const data = detail.data;
  if (data !== undefined && data !== null) {
    if (Array.isArray(data)) {
      return pickKycRecordFromArray(data, matchId, matchKycId, matchUserId);
    }
    if (typeof data === "object") return data;
  }

  if (Array.isArray(detail.content)) {
    return pickKycRecordFromArray(detail.content, matchId, matchKycId, matchUserId);
  }
  if (Array.isArray(detail.items)) {
    return pickKycRecordFromArray(detail.items, matchId, matchKycId, matchUserId);
  }
  if (Array.isArray(detail.results)) {
    return pickKycRecordFromArray(detail.results, matchId, matchKycId, matchUserId);
  }

  return detail;
}

/**
 * Merge `GET /kyc/{userId}` (or legacy admin detail) into a normalized queue row for richer document URLs.
 */
export function mergeAdminKycDetailRow(normalizedRow, detail) {
  if (!normalizedRow || typeof normalizedRow !== "object") return normalizedRow;
  if (detail == null) return normalizedRow;

  auditKycDetail("raw detail payload", detail);

  const record = unwrapKycDetailRecord(detail, {
    matchId: resolveKycApiPathId(normalizedRow),
    matchKycId: safeStr(normalizedRow.kycRecordId || normalizedRow.id),
    matchUserId: resolveKycModerationUserId(normalizedRow),
  });
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    auditKycDetail("unwrap produced no record", { detailType: typeof detail, isArray: Array.isArray(detail) });
    return normalizedRow;
  }

  auditKycDetail("unwrapped record", {
    id: record.id,
    documentUrl: record.documentUrl,
    documentFile: record.documentFile,
    aadhaarFrontUrl: record.aadhaarFrontUrl,
    frontDocumentUrl: record.frontDocumentUrl,
  });

  const baseRaw =
    normalizedRow._raw && typeof normalizedRow._raw === "object"
      ? { ...normalizedRow._raw }
      : { ...normalizedRow };
  const mergedSource = { ...baseRaw, ...record };
  const anchorId = String(normalizedRow.id || "").trim();
  const next = normalizeAdminKycRow(mergedSource, 0);
  if (!next) return normalizedRow;

  const merged = anchorId ? { ...next, id: anchorId } : next;
  auditKycDetail("normalized after merge", {
    id: merged.id,
    documentUrl: merged.documentUrl,
    documentFile: merged.documentFile,
    aadhaarFrontUrl: merged.aadhaarFrontUrl,
    frontDocumentUrl: merged.frontDocumentUrl,
    previewSlotCount: getAdminKycDocumentPreviewSlots(merged).length,
  });
  return merged;
}

/** Preserve document URLs when re-syncing the drawer from the list after reload. */
const KYC_DOC_URL_KEYS = KYC_DOCUMENT_URL_KEYS;

export function kycNormalizedRowToDetailPatch(row) {
  if (!row || typeof row !== "object") return {};
  const raw = row._raw && typeof row._raw === "object" ? row._raw : {};
  const out = {};
  for (const k of KYC_DOC_URL_KEYS) {
    const v = safeStr(row[k]) || safeStr(raw[k]);
    if (v) out[k] = v;
  }
  for (const listKey of ["documents", "kycDocuments", "kycDocumentUrls"]) {
    const arr = row[listKey] || raw[listKey];
    if (Array.isArray(arr) && arr.length) out[listKey] = arr;
  }
  return out;
}

/**
 * Normalize one admin KYC queue row from backend variants (no mock data).
 * @param {object} raw
 * @param {number} [index]
 */
export function normalizeAdminKycRow(raw, index = 0) {
  const r = raw && typeof raw === "object" ? raw : {};
  const nestedUser = r.user && typeof r.user === "object" ? r.user : null;
  const nestedProfile = r.profile && typeof r.profile === "object" ? r.profile : nestedUser?.profile || null;
  /** Common backend nests (identity may live here while document fields stay on the root). */
  const applicant = r.applicant && typeof r.applicant === "object" ? r.applicant : null;
  const applicantInfo = r.applicantInfo && typeof r.applicantInfo === "object" ? r.applicantInfo : null;
  const userDetails = r.userDetails && typeof r.userDetails === "object" ? r.userDetails : null;
  const nestedApplication =
    (r.application && typeof r.application === "object" ? r.application : null) ||
    (r.kycApplication && typeof r.kycApplication === "object" ? r.kycApplication : null);

  const userId = pickFirst(
    r.userId,
    r.user_id,
    nestedUser?.userId,
    nestedUser?.user_id,
    nestedUser?.id,
    applicant?.userId,
    applicantInfo?.userId,
    userDetails?.userId,
    nestedApplication?.userId,
  );

  const kycRecordId = pickFirst(
    r.id,
    r.kycId,
    r.requestId,
    r.applicationId,
    r.submissionId,
  );

  const id = kycRecordId || userId || `kyc_${index}`;

  const fullName = pickFirst(
    r.fullName,
    r.full_name,
    r.name,
    r.displayName,
    r.display_name,
    r.userName,
    r.user_name,
    r.username,
    nestedUser?.name,
    nestedUser?.fullName,
    nestedUser?.full_name,
    nestedUser?.displayName,
    nestedUser?.userName,
    nestedUser?.username,
    nestedProfile?.name,
    nestedProfile?.fullName,
    nestedProfile?.displayName,
    applicant?.name,
    applicant?.fullName,
    applicant?.full_name,
    applicant?.displayName,
    applicant?.userName,
    applicantInfo?.name,
    applicantInfo?.fullName,
    applicantInfo?.displayName,
    userDetails?.name,
    userDetails?.fullName,
    nestedApplication?.fullName,
    nestedApplication?.name,
    nestedApplication?.displayName,
    [nestedUser?.firstName, nestedUser?.lastName].filter(Boolean).join(" "),
    [nestedProfile?.firstName, nestedProfile?.lastName].filter(Boolean).join(" "),
    [applicant?.firstName, applicant?.lastName].filter(Boolean).join(" "),
    [r.firstName, r.lastName].filter(Boolean).join(" "),
    [r.first_name, r.last_name].filter(Boolean).join(" "),
  );

  const email = pickFirst(
    r.email,
    r.userEmail,
    r.user_email,
    r.contactEmail,
    nestedUser?.email,
    nestedUser?.userEmail,
    nestedProfile?.email,
    nestedProfile?.userEmail,
    applicant?.email,
    applicant?.userEmail,
    applicantInfo?.email,
    userDetails?.email,
    nestedApplication?.email,
    nestedApplication?.userEmail,
  );

  const phone = pickFirst(
    r.phone,
    r.phoneNumber,
    r.phone_number,
    r.mobile,
    r.mobileNumber,
    r.mobile_number,
    r.userPhone,
    nestedUser?.phone,
    nestedUser?.phoneNumber,
    nestedUser?.mobile,
    nestedProfile?.phone,
    nestedProfile?.phoneNumber,
    nestedProfile?.mobile,
    applicant?.phone,
    applicant?.phoneNumber,
    applicantInfo?.phone,
    userDetails?.phone,
    nestedApplication?.phone,
    nestedApplication?.phoneNumber,
  );

  const dateOfBirth = pickFirst(r.dateOfBirth, r.dob, nestedProfile?.dateOfBirth, r.birthDate);

  const address = pickFirst(r.address, r.streetAddress, nestedProfile?.address, r.line1);

  const country = pickFirst(r.country, r.countryCode, nestedProfile?.country);

  const documentType = pickFirst(
    r.documentType,
    r.docType,
    r.idType,
    r.kycDocumentType,
    "—",
  );

  const documentNumber = pickFirst(r.documentNumber, r.idNumber, r.docNumber, r.panNumber, r.aadhaarNumber);

  const pickRawDoc = (...vals) => pickFirst(...vals);

  const aadhaarFrontUrl = pickRawDoc(
    r.aadhaarFrontUrl,
    r.aadhaar_front_url,
    nestedProfile?.aadhaarFrontUrl,
  );
  const aadhaarBackUrl = pickRawDoc(
    r.aadhaarBackUrl,
    r.aadhaar_back_url,
    nestedProfile?.aadhaarBackUrl,
  );
  const panCardUrl = pickRawDoc(
    r.panCardUrl,
    r.pan_url,
    r.panImageUrl,
    r.panDocumentUrl,
    r.panFrontUrl,
    nestedProfile?.panCardUrl,
    nestedProfile?.pan_url,
  );
  const passportUrl = pickRawDoc(
    r.passportUrl,
    r.passportImageUrl,
    r.passportFrontUrl,
    nestedProfile?.passportUrl,
  );
  const drivingLicenseUrl = pickRawDoc(
    r.drivingLicenseUrl,
    r.dlUrl,
    r.drivingLicenceUrl,
    r.licenseFrontUrl,
    nestedProfile?.drivingLicenseUrl,
  );
  const livePhotoUrl = pickRawDoc(
    r.livePhotoUrl,
    r.live_photo_url,
    r.livePhoto,
    r.livenessImageUrl,
    r.livenessUrl,
    nestedProfile?.livePhotoUrl,
  );
  const filePath = pickRawDoc(
    r.filePath,
    r.file_path,
    r.documentFile,
    r.document_file,
    r.documentPath,
    r.document_path,
    r.documentUrl,
    r.document_url,
    r.imageUrl,
    r.image_url,
    nestedProfile?.filePath,
    nestedProfile?.documentFile,
    nestedProfile?.documentUrl,
    nestedApplication?.filePath,
    nestedApplication?.documentFile,
    nestedApplication?.documentUrl,
  );
  const documentUrl = pickRawDoc(
    r.documentUrl,
    r.document_url,
    r.documentFile,
    r.document_file,
    r.filePath,
    r.file_path,
    nestedProfile?.documentUrl,
    nestedProfile?.documentFile,
    nestedApplication?.documentUrl,
    nestedApplication?.documentFile,
  );
  const documentFile = pickRawDoc(
    r.documentFile,
    r.document_file,
    r.documentUrl,
    r.document_url,
    r.filePath,
    nestedProfile?.documentFile,
    nestedApplication?.documentFile,
  );
  const documentFrontUrl = pickRawDoc(
    r.documentFrontUrl,
    r.documentFront,
    r.document_front,
    nestedProfile?.documentFrontUrl,
    nestedProfile?.documentFront,
  );
  const documentBackUrl = pickRawDoc(
    r.documentBackUrl,
    r.documentBack,
    r.document_back,
    nestedProfile?.documentBackUrl,
    nestedProfile?.documentBack,
  );

  const frontDocumentUrl = pickRawDoc(
    r.frontDocumentUrl,
    r.frontUrl,
    r.documentFrontUrl,
    r.idFrontUrl,
    r.frontImageUrl,
    r.aadhaarFrontUrl,
    r.aadhaar_front_url,
    r.panCardUrl,
    r.pan_url,
    r.passportUrl,
    r.drivingLicenseUrl,
    r.documentFront,
    r.document_front,
    nestedProfile?.aadhaarFrontUrl,
  );
  const backDocumentUrl = pickRawDoc(
    r.backDocumentUrl,
    r.backUrl,
    r.documentBackUrl,
    r.idBackUrl,
    r.backImageUrl,
    r.aadhaarBackUrl,
    r.aadhaar_back_url,
    r.documentBack,
    r.document_back,
    nestedProfile?.aadhaarBackUrl,
  );
  const selfieUrl = pickRawDoc(
    r.selfieUrl,
    r.selfieImageUrl,
    r.faceUrl,
    r.portraitUrl,
    nestedProfile?.selfieUrl,
    nestedProfile?.selfieImageUrl,
  );

  const submittedAtRaw = pickFirst(
    r.submittedAt,
    r.createdAt,
    r.submittedOn,
    r.uploadedAt,
    r.requestedAt,
    r.createdOn,
  );

  const statusRaw = pickFirst(
    r.status,
    r.kycStatus,
    r.verificationStatus,
    r.state,
    nestedUser?.kycStatus,
    nestedProfile?.kycStatus,
  );

  const canonicalStatus = canonicalizeKycStatus(statusRaw);

  const rejectionReason = (() => {
    const candidates = [
      r.rejectionReason,
      r.rejectReason,
      r.kycRejectionReason,
      r.rejectionMessage,
      r.reason,
      r.reviewNotes,
      r.adminComment,
      r.rejectNotes,
      r.instructions,
      r.reuploadInstructions,
      nestedProfile?.rejectionReason,
      nestedProfile?.rejectReason,
      nestedProfile?.kycRejectionReason,
      nestedProfile?.reason,
    ];
    for (const v of candidates) {
      const s = safeStr(v);
      if (s && !isKycRejectHelperCopy(s)) return s;
    }
    return "";
  })();

  const reviewedBy = pickFirst(r.reviewedBy, r.reviewer, r.reviewedByEmail, r.moderatorId);
  const reviewedAtRaw = pickFirst(r.reviewedAt, r.reviewedOn, r.updatedAt, r.decisionAt);

  const riskFlag = Boolean(r.riskFlag || r.highRisk || r.flagged || r.suspicious);

  const submittedAt = parseIsoOrDisplay(submittedAtRaw);
  const reviewedAt = reviewedAtRaw ? parseIsoOrDisplay(reviewedAtRaw) : "—";

  const displayStatus = kycCanonicalLabel(canonicalStatus);

  const initials = (() => {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || "";
    const s = `${a}${b}`.toUpperCase();
    return s || "U";
  })();

  return {
    ...r,
    id,
    userId: userId || "",
    kycRecordId: kycRecordId || id,
    fullName: fullName || "—",
    email: email || "—",
    phone: phone || "—",
    dateOfBirth: dateOfBirth || "—",
    address: address || "—",
    country: country || "—",
    documentType,
    documentNumber: documentNumber || "—",
    filePath,
    documentUrl,
    documentFile,
    aadhaarFrontUrl,
    aadhaarBackUrl,
    panCardUrl,
    passportUrl,
    drivingLicenseUrl,
    livePhotoUrl,
    documentFrontUrl,
    documentBackUrl,
    frontDocumentUrl,
    backDocumentUrl,
    selfieUrl,
    submittedAt,
    submittedAtRaw,
    canonicalStatus,
    displayStatus,
    statusRaw: statusRaw || "—",
    rejectionReason: rejectionReason || "",
    reviewedBy: reviewedBy || "—",
    reviewedAt,
    riskFlag,
    initials,
    _raw: r,
  };
}

export function kycStatsFromNormalizedRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    pending: list.filter((x) => x.canonicalStatus === KYC_CANONICAL.PENDING).length,
    underReview: list.filter((x) => x.canonicalStatus === KYC_CANONICAL.UNDER_REVIEW).length,
    approved: list.filter((x) => x.canonicalStatus === KYC_CANONICAL.VERIFIED).length,
    rejected: list.filter((x) => x.canonicalStatus === KYC_CANONICAL.REJECTED).length,
    reupload: list.filter((x) => x.canonicalStatus === KYC_CANONICAL.REUPLOAD_REQUIRED).length,
  };
}
