import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("./backendClient", () => {
  return {
    backendJson: vi.fn(),
    backendMultipart: vi.fn(),
    backendPost: vi.fn(),
    backendBlob: vi.fn(),
  };
});

import { backendJson, backendMultipart } from "./backendClient";
import {
  favoritesBackend,
  isKycPresignRouteCollisionError,
  kycAdminBackend,
  kycBackend,
} from "./backendApis";

describe("favoritesBackend.list", () => {
  it("falls back to /favorites/list when /favorites/my returns 500 GET not supported", async () => {
    const favs = [{ appId: 1 }, { appId: 2 }];

    // First call: throw a 500 'GET not supported' error
    backendJson.mockImplementationOnce(() => {
      const err = new Error("Request method 'GET' is not supported");
      err.status = 500;
      err.payload = { message: "Request method 'GET' is not supported" };
      throw err;
    });

    // Second call: return the favorites list
    backendJson.mockResolvedValueOnce(favs);

    const res = await favoritesBackend.list();
    expect(res).toEqual(favs);
    expect(backendJson).toHaveBeenCalledTimes(2);
    expect(backendJson.mock.calls[0][0]).toBe("/favorites/my");
    expect(backendJson.mock.calls[1][0]).toBe("/favorites/list");
  });
});

describe("kycBackend multipart guard", () => {
  it("blocks upload when documentType is missing from FormData", async () => {
    const fd = new FormData();
    fd.append("file", new File(["x"], "id.pdf", { type: "application/pdf" }));

    expect(() => kycBackend.upload(fd)).toThrow(/documentType/i);
    expect(backendMultipart).not.toHaveBeenCalled();
  });

  it("submits complete upload payload to /kyc/upload", async () => {
    backendMultipart.mockResolvedValueOnce({ success: true });

    const fd = new FormData();
    fd.append("documentType", "PAN");
    fd.append("documentNumber", "ABCDE1234F");
    fd.append("file", new File(["x"], "id.pdf", { type: "application/pdf" }));

    await kycBackend.upload(fd);

    expect(backendMultipart).toHaveBeenCalledWith("/kyc/upload", fd);
  });
});

describe("isKycPresignRouteCollisionError", () => {
  it("detects document-access Long parse collision", () => {
    const err = new Error(
      'Failed to convert value of type \'java.lang.String\' to required type \'java.lang.Long\'; For input string: "document-access"',
    );
    err.status = 500;
    expect(isKycPresignRouteCollisionError(err)).toBe(true);
  });
});

describe("kycAdminBackend documentAccess fallback", () => {
  beforeEach(() => {
    backendJson.mockReset();
  });

  it("falls back through missing routes to POST presign", async () => {
    const collision = () => {
      const err = new Error(
        'Failed to convert value of type \'java.lang.String\' to required type \'java.lang.Long\'; For input string: "document-access"',
      );
      err.status = 500;
      throw err;
    };
    const notFound = () => {
      const err = new Error("Not Found");
      err.status = 404;
      throw err;
    };

    backendJson
      .mockImplementationOnce(notFound)
      .mockResolvedValueOnce("https://bucket.s3.amazonaws.com/kyc/a.pdf?X-Amz-Signature=abc");

    const res = await kycAdminBackend.documentAccess(
      "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/a.pdf",
    );

    expect(res).toContain("X-Amz-Signature");
    expect(backendJson.mock.calls[0][0]).toContain("/admin/kyc-documents/presign-url");
    expect(backendJson.mock.calls[1][0]).toBe("/admin/kyc/presign");
    expect(backendJson.mock.calls[1][1]?.method).toBe("POST");
  });

  it("skips colliding GET document-access when earlier routes fail", async () => {
    const collision = () => {
      const err = new Error(
        'Failed to convert value of type \'java.lang.String\' to required type \'java.lang.Long\'; For input string: "document-access"',
      );
      err.status = 500;
      throw err;
    };

    backendJson
      .mockImplementationOnce(collision)
      .mockImplementationOnce(collision)
      .mockImplementationOnce(collision)
      .mockImplementationOnce(collision);

    await expect(
      kycAdminBackend.documentAccess(
        "https://authify-kyc-prod.s3.ap-south-1.amazonaws.com/kyc/a.pdf",
      ),
    ).rejects.toThrow(/long/i);
    expect(backendJson).toHaveBeenCalledTimes(4);
  });
});

describe("kycAdminBackend routes", () => {
  beforeEach(() => {
    backendJson.mockReset();
  });

  it("uses /admin/kyc/all as the primary list endpoint", async () => {
    backendJson.mockResolvedValueOnce([{ id: 1 }]);

    await kycAdminBackend.listAll();

    expect(backendJson).toHaveBeenCalledWith("/admin/kyc/all", {
      method: "GET",
    });
  });

  it("falls back to /kyc/all when admin route is missing", async () => {
    backendJson
      .mockImplementationOnce(() => {
        const err = new Error("NoHandlerFoundException");
        err.status = 404;
        err.payload = { message: "No endpoint GET /api/v1.0/admin/kyc/all" };
        throw err;
      })
      .mockResolvedValueOnce([{ id: 2 }]);

    const res = await kycAdminBackend.listAll();

    expect(res).toEqual([{ id: 2 }]);
    expect(backendJson.mock.calls[0][0]).toBe("/admin/kyc/all");
    expect(backendJson.mock.calls[1][0]).toBe("/kyc/all");
  });
});
