import { kycAdminBackend, kycBackend } from "../services/backendApis";
import {
  isPresignedS3Url,
  isPrivateS3DocumentUrl,
  isS3KycDocumentUrl,
  resolveKycDocumentUrl,
} from "./mediaUrl";

/** Max presign fetches per stored URL (prevents infinite retry loops). */
export const KYC_DOCUMENT_ACCESS_MAX_ATTEMPTS = 3;

function extractAccessUrl(payload) {
  if (payload == null) return "";
  if (typeof payload === "string") return payload.trim();
  if (typeof payload !== "object") return "";
  const nodes = [payload];
  if (payload.data != null) nodes.push(payload.data);
  for (const node of nodes) {
    if (typeof node === "string" && node.trim()) return node.trim();
    if (node && typeof node === "object") {
      for (const key of ["url", "accessUrl", "presignedUrl", "signedUrl"]) {
        const v = String(node[key] ?? "").trim();
        if (v) return v;
      }
    }
  }
  return "";
}

/**
 * Strip presign query params — backend validates/stores canonical S3 object URLs.
 * @param {string} storedUrl
 * @returns {string}
 */
export function normalizeKycStoredUrlForAccess(storedUrl) {
  const raw = String(storedUrl ?? "").trim();
  if (!raw) return "";
  if (!isS3KycDocumentUrl(raw)) return raw;
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split("?")[0];
  }
}

/** User-facing label — never show permanent private S3 URLs in UI. */
export function maskKycStoredLabel(storedUrl) {
  const raw = String(storedUrl ?? "").trim();
  if (!raw) return "—";
  if (isS3KycDocumentUrl(raw)) {
    try {
      const name = new URL(normalizeKycStoredUrlForAccess(raw)).pathname.split("/").pop();
      return name ? `Secure document (${name})` : "Secure document";
    } catch {
      return "Secure document";
    }
  }
  if (raw.length > 64) return `${raw.slice(0, 32)}…${raw.slice(-12)}`;
  return raw;
}

/**
 * Resolve a KYC document URL for display/download.
 * Private S3 objects always go through authenticated document-access APIs.
 *
 * @param {string} storedUrl raw path/URL from backend
 * @param {{ admin?: boolean }} [opts]
 * @returns {Promise<string>}
 */
export async function fetchKycDocumentAccessUrl(storedUrl, opts = {}) {
  const raw = String(storedUrl ?? "").trim();
  if (!raw) return "";

  if (isPresignedS3Url(raw)) {
    return raw;
  }

  if (isS3KycDocumentUrl(raw)) {
    const canonical = normalizeKycStoredUrlForAccess(raw);
    const api = opts.admin ? kycAdminBackend : kycBackend;
    const res = await api.documentAccess(canonical, opts);
    const signed = extractAccessUrl(res);
    if (signed && isPresignedS3Url(signed)) return signed;
    return "";
  }

  return resolveKycDocumentUrl(raw);
}

export { isPrivateS3DocumentUrl, isPresignedS3Url, isS3KycDocumentUrl };
