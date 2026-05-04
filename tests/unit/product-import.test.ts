import { describe, expect, it } from "vitest";
import {
  generateImportBarcode,
  normalizeImportBarcode,
} from "../../api/services/product-import/barcode";

describe("product import barcode generation", () => {
  it("keeps a valid 13 digit Hipicon barcode as-is", () => {
    expect(normalizeImportBarcode("8691234567890", 15)).toBe("8691234567890");
  });

  it("pads short barcodes with the persistent seller number on the left", () => {
    const barcode = normalizeImportBarcode("12345", 15);

    expect(barcode).toBe("1500000012345");
    expect(barcode).toHaveLength(13);
  });

  it("uses only the missing number of seller prefix digits for partial Hipicon barcodes", () => {
    const barcode = normalizeImportBarcode("12345678901", 120);

    expect(barcode).toBe("1212345678901");
    expect(barcode).toHaveLength(13);
  });

  it("generates a deterministic seller-prefixed barcode when the source has no barcode", () => {
    const first = generateImportBarcode({
      raw: "",
      sellerNumber: 15,
      seed: "hipicon:product:abc",
    });
    const second = generateImportBarcode({
      raw: "",
      sellerNumber: 15,
      seed: "hipicon:product:abc",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^15\d{11}$/);
  });

  it("generates different barcodes for product variants", () => {
    const first = generateImportBarcode({
      sellerNumber: 15,
      seed: "hipicon:product:abc:variant:0",
    });
    const second = generateImportBarcode({
      sellerNumber: 15,
      seed: "hipicon:product:abc:variant:1",
    });

    expect(first).not.toBe(second);
    expect(first).toHaveLength(13);
    expect(second).toHaveLength(13);
  });

  it("keeps the source digits and trims the seller prefix to the missing length", () => {
    const barcode = generateImportBarcode({
      raw: "12345678901",
      sellerNumber: 120,
      seed: "hipicon:product:partial",
    });

    expect(barcode).toBe("1212345678901");
  });
});
