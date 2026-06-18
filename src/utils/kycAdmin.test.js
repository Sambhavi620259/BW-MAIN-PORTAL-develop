import { beforeAll, describe, it, expect, vi } from "vitest";
import { getAdminKycDocumentPreviewSlots } from "./kycAdmin";

/**
 * Private (non-presigned) S3 KYC URL — requires presign before display.
 * Used as the base for constructing presigned variants.
 */
const S3_BASE = "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc";
const PRIVATE = (path) => `${S3_BASE}/${path}`;
const PRESIGNED = (path, sig = "sig1") =>
  `${S3_BASE}/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${sig}&X-Amz-Expires=3600`;

beforeAll(() => {
  vi.stubEnv("VITE_API_URL", "http://43.205.116.38:8080");
});

describe("getAdminKycDocumentPreviewSlots", () => {
  // ── Deduplication: identical stored URL in front + back ────────────────────

  it("deduplicates aadhaarFrontUrl and aadhaarBackUrl pointing to the same stored URL", () => {
    const url = PRIVATE("user/upload.jpg");
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: url,
      aadhaarBackUrl: url,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].storedUrl).toBe(url);
  });

  // ── Deduplication: presigned URLs with different query params but same object ──

  it("deduplicates front/back presigned URLs that point to the same S3 object", () => {
    const front = PRESIGNED("user/upload.jpg", "sigFRONT");
    const back = PRESIGNED("user/upload.jpg", "sigBACK");
    // Both share the same base path — different X-Amz-Signature values should
    // not cause them to be treated as different documents.
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: front,
      aadhaarBackUrl: back,
    });
    expect(slots).toHaveLength(1);
  });

  it("deduplicates when generic documentUrl has same base path as typed field (different sig)", () => {
    const typed = PRESIGNED("user/doc.jpg", "typedSig");
    const generic = PRESIGNED("user/doc.jpg", "genericSig");
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: typed,
      documentUrl: generic,
    });
    expect(slots).toHaveLength(1);
  });

  // ── Current + previous: distinct documents should both render ──────────────

  it("shows current typed document and immediately previous document when they differ", () => {
    // Typical reupload scenario: current Aadhaar in typed field, previous
    // submission stored in the generic documentUrl field.
    const current = PRIVATE("user/aadhaar-v2.jpg");
    const previous = PRIVATE("user/aadhaar-v1.jpg");
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: current,
      documentUrl: previous,
    });
    expect(slots).toHaveLength(2);
    // Current document (typed field) must be first.
    expect(slots[0].storedUrl).toBe(current);
    expect(slots[1].storedUrl).toBe(previous);
  });

  it("shows front and back when they are genuinely different documents", () => {
    const front = PRIVATE("user/aadhaar-front.jpg");
    const back = PRIVATE("user/aadhaar-back.jpg");
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: front,
      aadhaarBackUrl: back,
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].storedUrl).toBe(front);
    expect(slots[1].storedUrl).toBe(back);
  });

  // ── Ancient / stale uploads must not appear ───────────────────────────────

  it("does not show an ancient filePath upload when typed + documentUrl fill the 2 slots", () => {
    const current = PRIVATE("user/aadhaar-current.jpg");
    const previous = PRIVATE("user/aadhaar-previous.jpg");
    const ancient = PRIVATE("user/mountain.jpg");
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: current,
      documentUrl: previous,
      filePath: ancient,
    });
    expect(slots).toHaveLength(2);
    // Ancient upload in filePath must not appear.
    const urls = slots.map((s) => s.storedUrl);
    expect(urls).toContain(current);
    expect(urls).toContain(previous);
    expect(urls).not.toContain(ancient);
  });

  it("does not show stale test/demo filenames", () => {
    // Filenames containing 'test', 'demo', 'sample', etc. are filtered.
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: PRIVATE("user/test_upload.jpg"),
    });
    expect(slots).toHaveLength(0);
  });

  // ── Presigned deduplication across field types ────────────────────────────

  it("deduplicates presigned URLs across typed and generic fields by base path", () => {
    const baseSig1 = PRESIGNED("user/kyc-doc.jpg", "AAA");
    const baseSig2 = PRESIGNED("user/kyc-doc.jpg", "BBB");
    const baseSig3 = PRESIGNED("user/kyc-doc.jpg", "CCC");
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: baseSig1, // slot 1
      aadhaarBackUrl: baseSig2,  // same base path → deduped
      documentUrl: baseSig3,     // same base path → deduped
    });
    expect(slots).toHaveLength(1);
  });

  // ── Reupload detection: frontDocumentUrl ≠ aadhaarFrontUrl ──────────────────

  it("shows only frontDocumentUrl (current reupload) and hides stale aadhaarFrontUrl when status is PENDING", () => {
    // Mirrors the exact API response shape where the backend stores the current
    // resubmission in frontDocumentUrl/backDocumentUrl while aadhaarFrontUrl/aadhaarBackUrl
    // still hold the original (stale) upload.
    const currentFace = PRESIGNED("kyc/598adf82-face.jpg", "sig1");
    const staleOriginal =
      "http://43.205.116.38:8080/uploads/documents/86cc00eb-65fb-4980-original.png";
    const anotherFile = PRESIGNED("kyc/c6244724-another.jpeg", "sig2");

    const slots = getAdminKycDocumentPreviewSlots({
      frontDocumentUrl: currentFace,
      backDocumentUrl: currentFace, // same file — deduped
      aadhaarFrontUrl: staleOriginal,
      aadhaarBackUrl: staleOriginal, // same file — deduped
      documentUrl: anotherFile,
      documentFile: anotherFile, // same file — deduped
      status: "PENDING",
    });

    // Only the current submission (frontDocumentUrl) renders.
    // staleOriginal and anotherFile are hidden: status=PENDING + reupload detected.
    expect(slots).toHaveLength(1);
    expect(slots[0].storedUrl).toBe(currentFace);
  });

  it("shows stale aadhaarFrontUrl as previous when frontDocumentUrl differs and status is REJECTED", () => {
    const currentFace = PRESIGNED("kyc/598adf82-face.jpg", "sig1");
    const staleOriginal =
      "http://43.205.116.38:8080/uploads/documents/86cc00eb-65fb-4980-original.png";

    const slots = getAdminKycDocumentPreviewSlots({
      frontDocumentUrl: currentFace,
      aadhaarFrontUrl: staleOriginal,
      status: "REJECTED",
    });

    // Admin is reviewing a rejection: both current + previous are shown for comparison.
    expect(slots).toHaveLength(2);
    expect(slots[0].storedUrl).toBe(currentFace);
    expect(slots[1].storedUrl).toBe(staleOriginal);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("returns empty array for empty row", () => {
    expect(getAdminKycDocumentPreviewSlots({})).toEqual([]);
    expect(getAdminKycDocumentPreviewSlots(null)).toEqual([]);
  });

  it("returns a single slot when only one document field is present", () => {
    const slots = getAdminKycDocumentPreviewSlots({
      aadhaarFrontUrl: PRIVATE("user/single.jpg"),
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].needsPresign).toBe(true);
  });

  it("reads document URLs from nested _raw backend shape", () => {
    const front = PRIVATE("user/front.jpg");
    const back = PRIVATE("user/back.jpg");
    const slots = getAdminKycDocumentPreviewSlots({
      id: "kyc_42",
      _raw: {
        aadhaarFrontUrl: front,
        aadhaarBackUrl: back,
      },
    });
    expect(slots).toHaveLength(2);
  });
});
