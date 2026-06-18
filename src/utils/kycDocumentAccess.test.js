import { beforeAll, describe, it, expect, vi } from "vitest";

beforeAll(() => {
  vi.stubEnv("VITE_API_URL", "http://43.205.116.38:8080");
});
import {
  isPresignedS3Url,
  isPrivateS3DocumentUrl,
  isS3KycDocumentUrl,
  resolveKycDocumentUrl,
} from "./mediaUrl";
import {
  maskKycStoredLabel,
  normalizeKycStoredUrlForAccess,
} from "./kycDocumentAccess";

const PRIVATE_S3 =
  "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/abc.pdf";

describe("KYC S3 URL detection", () => {
  it("detects private bucket URLs without presign params", () => {
    expect(isPrivateS3DocumentUrl(PRIVATE_S3)).toBe(true);
    expect(isS3KycDocumentUrl(PRIVATE_S3)).toBe(true);
  });

  it("treats presigned URLs as S3 but not private", () => {
    const signed = `${PRIVATE_S3}?X-Amz-Signature=abc`;
    expect(isPresignedS3Url(signed)).toBe(true);
    expect(isPrivateS3DocumentUrl(signed)).toBe(false);
    expect(isS3KycDocumentUrl(signed)).toBe(true);
  });

  it("does not flag local uploads paths as S3", () => {
    expect(isS3KycDocumentUrl("/uploads/documents/id.png")).toBe(false);
  });
});

describe("resolveKycDocumentUrl security", () => {
  it("never returns raw private S3 URLs", () => {
    expect(resolveKycDocumentUrl(PRIVATE_S3)).toBe("");
  });

  it("never returns presigned S3 URLs for direct UI use", () => {
    const signed = `${PRIVATE_S3}?X-Amz-Signature=abc`;
    expect(resolveKycDocumentUrl(signed)).toBe("");
  });

  it("still resolves legacy uploads paths", () => {
    const resolved = resolveKycDocumentUrl("/uploads/documents/id.png");
    expect(resolved).toContain("/uploads/documents/id.png");
  });
});

describe("normalizeKycStoredUrlForAccess", () => {
  it("strips presign query params before document-access call", () => {
    const signed = `${PRIVATE_S3}?X-Amz-Signature=abc&X-Amz-Expires=900`;
    expect(normalizeKycStoredUrlForAccess(signed)).toBe(PRIVATE_S3);
  });

  it("masks S3 URLs for display labels", () => {
    expect(maskKycStoredLabel(PRIVATE_S3)).toBe("Secure document (abc.pdf)");
  });
});
