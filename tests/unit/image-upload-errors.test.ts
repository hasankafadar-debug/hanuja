import { describe, expect, it } from "vitest";
import {
  getCorsOrNetworkMessage,
  getUploadStatusMessage,
  parseConfirmPayload,
  parseUploadFailure,
  parseUploadUrlPayload,
} from "../../apps/seller-panel/src/components/image-upload-errors";

describe("image upload error helpers", () => {
  it("maps 403 upload failures to auth/signature guidance", () => {
    expect(getUploadStatusMessage(403, "Forbidden")).toContain("reddedildi");
  });

  it("maps 413 upload failures to size guidance", () => {
    expect(getUploadStatusMessage(413)).toContain("boyutu");
  });

  it("maps 404 upload failures to missing upload target guidance", () => {
    expect(getUploadStatusMessage(404, "Not Found")).toContain(
      "Yükleme hedefi",
    );
  });

  it("maps xml R2 errors to human-readable Turkish messages", () => {
    const message = parseUploadFailure({
      status: 403,
      statusText: "Forbidden",
      bodyText:
        "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match.</Message></Error>",
    });

    expect(message).toContain("imza");
  });

  it("returns a CORS/network specific message for fetch type errors", () => {
    expect(getCorsOrNetworkMessage(new TypeError("Failed to fetch"))).toContain(
      "CORS",
    );
  });

  it("unwraps media upload URL responses from the API data envelope", () => {
    const parsed = parseUploadUrlPayload({
      success: true,
      data: {
        asset: { id: "asset-1", url: "https://cdn.example/asset-1.webp" },
        uploadUrl: "https://upload.example/presigned",
      },
    });

    expect(parsed.asset.id).toBe("asset-1");
    expect(parsed.uploadUrl).toBe("https://upload.example/presigned");
  });

  it("keeps backwards compatibility with unwrapped media upload responses", () => {
    const parsed = parseUploadUrlPayload({
      asset: { id: "asset-1" },
      uploadUrl: "https://upload.example/presigned",
    });

    expect(parsed.asset.id).toBe("asset-1");
    expect(parsed.uploadUrl).toBe("https://upload.example/presigned");
  });

  it("fails before PUT when the upload URL is missing", () => {
    expect(() =>
      parseUploadUrlPayload({
        success: true,
        data: { asset: { id: "asset-1" } },
      }),
    ).toThrow("upload bağlantısını");
  });

  it("unwraps confirm responses and falls back to the presign asset URL", () => {
    expect(
      parseConfirmPayload(
        {
          success: true,
          data: { id: "asset-1", url: "https://cdn.example/confirmed.webp" },
        },
        { id: "asset-1", url: "https://cdn.example/pending.webp" },
      ).url,
    ).toBe("https://cdn.example/confirmed.webp");

    expect(
      parseConfirmPayload(
        { success: true, data: { id: "asset-1" } },
        {
          id: "asset-1",
          url: "https://cdn.example/pending.webp",
        },
      ).url,
    ).toBe("https://cdn.example/pending.webp");
  });
});
