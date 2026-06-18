import { beforeAll, describe, it, expect, vi } from "vitest";
import {
  hasKycDocumentCandidates,
  pickPrimaryKycDocumentStoredUrl,
  resolveKycDocumentCandidates,
  isPlausibleKycDocumentStoredUrl,
} from "./kycDocumentCandidates";

const PRIVATE_S3 =
  "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/front.jpg";

beforeAll(() => {
  vi.stubEnv("VITE_API_URL", "http://43.205.116.38:8080");
});

describe("resolveKycDocumentCandidates", () => {
  it("resolves aadhaarFrontUrl-only payload", () => {
    const candidates = resolveKycDocumentCandidates({
      aadhaarFrontUrl: PRIVATE_S3,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].key).toBe("aadhaarFrontUrl");
    expect(candidates[0].storedUrl).toBe(PRIVATE_S3);
    expect(candidates[0].needsSecureAccess).toBe(true);
    expect(candidates[0].previewSafeUrl).toBe("");
  });

  it("uses presigned S3 URLs from list API without extra presign fetch", () => {
    const signed = `${PRIVATE_S3}?X-Amz-Signature=abc`;
    const candidates = resolveKycDocumentCandidates({
      aadhaarFrontUrl: signed,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].needsSecureAccess).toBe(false);
    expect(candidates[0].previewSafeUrl).toBe(signed);
  });

  it("resolves documentUrl-only payload", () => {
    const candidates = resolveKycDocumentCandidates({
      documentUrl: "/uploads/documents/pan.png",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].key).toBe("documentUrl");
    expect(candidates[0].storedUrl).toBe("/uploads/documents/pan.png");
    expect(candidates[0].needsSecureAccess).toBe(false);
    expect(candidates[0].previewSafeUrl).toContain("/uploads/documents/pan.png");
  });

  it("dedupes mixed payloads pointing at same S3 object", () => {
    const candidates = resolveKycDocumentCandidates({
      aadhaarFrontUrl: PRIVATE_S3,
      frontDocumentUrl: PRIVATE_S3,
      documentUrl: PRIVATE_S3,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].key).toBe("aadhaarFrontUrl");
  });

  it("returns multiple distinct documents from mixed payload", () => {
    const candidates = resolveKycDocumentCandidates({
      aadhaarFrontUrl: PRIVATE_S3,
      aadhaarBackUrl: PRIVATE_S3.replace("front.jpg", "back.jpg"),
      documentFile: "/uploads/documents/extra.pdf",
    });
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(hasKycDocumentCandidates({ aadhaarFrontUrl: PRIVATE_S3 })).toBe(true);
  });

  it("returns empty for missing payloads", () => {
    expect(resolveKycDocumentCandidates({})).toEqual([]);
    expect(resolveKycDocumentCandidates(null)).toEqual([]);
    expect(hasKycDocumentCandidates({ status: "PENDING" })).toBe(false);
    expect(pickPrimaryKycDocumentStoredUrl({})).toBe("");
  });

  it("reads nested _raw backend shapes", () => {
    const candidates = resolveKycDocumentCandidates({
      id: 12,
      _raw: {
        aadhaarFrontUrl: PRIVATE_S3,
        backDocumentUrl: PRIVATE_S3.replace("front.jpg", "back.jpg"),
      },
    });
    expect(candidates.length).toBe(2);
  });

  it("picks primary by field priority", () => {
    expect(
      pickPrimaryKycDocumentStoredUrl({
        filePath: "/uploads/documents/old.png",
        aadhaarFrontUrl: PRIVATE_S3,
      }),
    ).toBe(PRIVATE_S3);
  });

  describe("pickPrimaryKycDocumentStoredUrl reupload and dedup logic", () => {
    const original = "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/original.jpg";
    const reupload = "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/reupload.jpg";

    it("original upload: returns aadhaarFrontUrl when frontDocumentUrl is not present", () => {
      const result = pickPrimaryKycDocumentStoredUrl({
        aadhaarFrontUrl: original,
        aadhaarBackUrl: original,
      });
      expect(result).toBe(original);
    });

    it("reupload: returns frontDocumentUrl when frontDocumentUrl differs from aadhaarFrontUrl", () => {
      const result = pickPrimaryKycDocumentStoredUrl({
        aadhaarFrontUrl: original,
        aadhaarBackUrl: original,
        frontDocumentUrl: reupload,
        backDocumentUrl: reupload,
      });
      expect(result).toBe(reupload);
    });

    it("duplicate front/back: returns original when both are identical", () => {
      const result = pickPrimaryKycDocumentStoredUrl({
        aadhaarFrontUrl: original,
        frontDocumentUrl: original,
      });
      expect(result).toBe(original);
    });

    it("presigned dedup: returns original when frontDocumentUrl and aadhaarFrontUrl point to the same object with different presigned signatures", () => {
      const originalPresigned1 = `${original}?X-Amz-Signature=sig1`;
      const originalPresigned2 = `${original}?X-Amz-Signature=sig2`;
      const result = pickPrimaryKycDocumentStoredUrl({
        aadhaarFrontUrl: originalPresigned1,
        frontDocumentUrl: originalPresigned2,
      });
      expect(result).toBe(originalPresigned1);
    });
  });

  describe("isPlausibleKycDocumentStoredUrl protocol validation", () => {
    it("allows valid https S3 URL", () => {
      expect(
        isPlausibleKycDocumentStoredUrl(
          "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/doc.jpg"
        )
      ).toBe(true);
    });

    it("allows valid local upload path", () => {
      expect(isPlausibleKycDocumentStoredUrl("/uploads/documents/pan.png")).toBe(true);
      expect(isPlausibleKycDocumentStoredUrl("uploads/documents/pan.png")).toBe(true);
    });

    it("rejects javascript payload", () => {
      expect(isPlausibleKycDocumentStoredUrl("javascript:alert(1)//")).toBe(false);
    });

    it("rejects malformed protocol", () => {
      expect(isPlausibleKycDocumentStoredUrl("malformed://foo")).toBe(false);
      expect(isPlausibleKycDocumentStoredUrl("data:image/png;base64,abc")).toBe(false);
      expect(isPlausibleKycDocumentStoredUrl("file:///C:/path")).toBe(false);
    });

    it("rejects empty/null/undefined values", () => {
      expect(isPlausibleKycDocumentStoredUrl("")).toBe(false);
      expect(isPlausibleKycDocumentStoredUrl(null)).toBe(false);
      expect(isPlausibleKycDocumentStoredUrl(undefined)).toBe(false);
    });
  });
});


