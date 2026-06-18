import { describe, expect, it } from "vitest";
import {
  assertKycMultipartFormData,
  buildKycUploadFormData,
  formatKycUploadApiError,
  getKycFormDataFieldNames,
  KycUploadValidationError,
  normalizeKycDocumentType,
  validateKycUploadFields,
  validateKycFile,
} from "./kycUpload";

describe("normalizeKycDocumentType", () => {
  it("normalizes common aliases", () => {
    expect(normalizeKycDocumentType("aadhar")).toBe("AADHAAR");
    expect(normalizeKycDocumentType("dl")).toBe("DRIVING_LICENSE");
    expect(normalizeKycDocumentType("PAN")).toBe("PAN");
  });
});

describe("validateKycUploadFields", () => {
  it("requires document type and number", () => {
    expect(validateKycUploadFields("", "")).toBe("Select a document type.");
    expect(validateKycUploadFields("PAN", "")).toBe("Enter the document number.");
  });

  it("validates PAN format", () => {
    expect(validateKycUploadFields("PAN", "ABCDE1234F")).toBe("");
    expect(validateKycUploadFields("PAN", "BAD")).toMatch(/Invalid PAN/);
  });
});

describe("buildKycUploadFormData", () => {
  it("includes documentType, documentNumber, and file for upload", () => {
    const file = new File(["pdf"], "id.pdf", { type: "application/pdf" });
    const formData = buildKycUploadFormData({
      file,
      documentType: "pan",
      documentNumber: "ABCDE1234F",
    });

    expect(getKycFormDataFieldNames(formData).sort()).toEqual(
      ["documentNumber", "documentType", "file"].sort(),
    );
    expect(formData.get("documentType")).toBe("PAN");
    expect(formData.get("documentNumber")).toBe("ABCDE1234F");
    expect(formData.get("file")).toBe(file);
  });

  it("rejects missing document type before upload", () => {
    const file = new File(["x"], "id.pdf", { type: "application/pdf" });
    expect(() =>
      buildKycUploadFormData({
        file,
        documentType: "",
        documentNumber: "ABCDE1234F",
      }),
    ).toThrow(KycUploadValidationError);
  });
});

describe("assertKycMultipartFormData", () => {
  it("flags incomplete multipart payloads", () => {
    const fd = new FormData();
    fd.append("file", new File(["x"], "a.pdf", { type: "application/pdf" }));
    expect(() => assertKycMultipartFormData(fd)).toThrow(/documentType/);
  });
});

describe("formatKycUploadApiError", () => {
  it("maps missing documentType backend errors", () => {
    const err = {
      message: "Required request parameter 'documentType' is not present",
    };
    expect(formatKycUploadApiError(err)).toMatch(/Document type is required/i);
  });
});

describe("validateKycFile", () => {
  it("allows valid JPEG, PNG, and PDF files", () => {
    const jpeg = new File(["x"], "doc.jpg", { type: "image/jpeg" });
    const png = new File(["x"], "doc.png", { type: "image/png" });
    const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });

    expect(() => validateKycFile(jpeg)).not.toThrow();
    expect(() => validateKycFile(png)).not.toThrow();
    expect(() => validateKycFile(pdf)).not.toThrow();
  });

  it("rejects files larger than 5MB", () => {
    const bigFile = new File(["x"], "large.png", { type: "image/png" });
    // Define a size property override
    Object.defineProperty(bigFile, "size", { value: 6 * 1024 * 1024 }); // 6MB
    expect(() => validateKycFile(bigFile)).toThrow(/size exceeds/);
  });

  it("rejects unsupported MIME types", () => {
    const svg = new File(["x"], "doc.svg", { type: "image/svg+xml" });
    const txt = new File(["x"], "doc.txt", { type: "text/plain" });

    expect(() => validateKycFile(svg)).toThrow(/Unsupported file format/);
    expect(() => validateKycFile(txt)).toThrow(/Unsupported file format/);
  });

  it("rejects unsupported file name extensions", () => {
    const exe = new File(["x"], "doc.exe", { type: "application/octet-stream" });
    const bat = new File(["x"], "doc.bat", { type: "application/x-bat" });
    expect(() => validateKycFile(exe)).toThrow(/Unsupported file format/);
    expect(() => validateKycFile(bat)).toThrow(/Unsupported file format/);
  });

  it("rejects explicit executable/script/svg extensions even if MIME type is forged", () => {
    const forgedSvg = new File(["x"], "hack.svg", { type: "image/png" });
    const forgedExe = new File(["x"], "hack.exe", { type: "application/pdf" });
    const forgedJs = new File(["x"], "hack.js", { type: "image/jpeg" });

    expect(() => validateKycFile(forgedSvg)).toThrow(/Executable, script, or SVG/);
    expect(() => validateKycFile(forgedExe)).toThrow(/Executable, script, or SVG/);
    expect(() => validateKycFile(forgedJs)).toThrow(/Executable, script, or SVG/);
  });
});

