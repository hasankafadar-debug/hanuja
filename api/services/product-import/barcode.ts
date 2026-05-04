function sellerPrefix(sellerNumber: number) {
  const normalized =
    String(Math.max(1, Math.trunc(sellerNumber))).replace(/\D/g, "") || "1";
  return normalized.slice(0, 12);
}

function sellerDigitsForGap(sellerNumber: number, missingLength: number) {
  if (missingLength <= 0) return "";

  const normalized =
    String(Math.max(1, Math.trunc(sellerNumber))).replace(/\D/g, "") || "1";
  return normalized.slice(0, missingLength);
}

function deterministicDigits(seed: string, length: number) {
  let output = "";
  let round = 0;

  while (output.length < length) {
    let hash = 2166136261;
    const source = `${seed}:${round}`;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    output += String(hash).padStart(10, "0");
    round += 1;
  }

  return output.slice(0, length);
}

function buildSellerPrefixedBarcode(sellerNumber: number, tailDigits: string) {
  const prefix = sellerPrefix(sellerNumber);
  const tailLength = 13 - prefix.length;
  const tail = tailDigits.slice(-tailLength);
  return `${prefix}${"0".repeat(tailLength - tail.length)}${tail}`;
}

function buildBarcodeFromSource(params: {
  sellerNumber: number;
  sourceDigits: string;
  fillDigits: string;
}) {
  const missingLength = Math.max(0, 13 - params.sourceDigits.length);
  const sellerDigits = sellerDigitsForGap(params.sellerNumber, missingLength);
  const fillLength = missingLength - sellerDigits.length;
  const filler = params.fillDigits.slice(0, fillLength).padEnd(fillLength, "0");
  return `${sellerDigits}${filler}${params.sourceDigits}`;
}

export function normalizeImportBarcode(
  raw: string | null | undefined,
  sellerNumber: number,
): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 13) return null;
  if (digits.length === 13) return digits;
  return buildBarcodeFromSource({
    sellerNumber,
    sourceDigits: digits,
    fillDigits: "",
  });
}

export function generateImportBarcode(params: {
  raw?: string | null | undefined;
  sellerNumber: number;
  seed: string;
  attempt?: number;
}) {
  const attempt = params.attempt ?? 0;
  const digits = params.raw?.replace(/\D/g, "") ?? "";

  if (attempt === 0 && digits.length === 13) return digits;
  if (attempt === 0 && digits.length > 0 && digits.length < 13) {
    return buildBarcodeFromSource({
      sellerNumber: params.sellerNumber,
      sourceDigits: digits,
      fillDigits: deterministicDigits(`${params.seed}:${digits}:source`, 13),
    });
  }

  const tailLength = 13 - sellerPrefix(params.sellerNumber).length;
  const tail = deterministicDigits(
    `${params.seed}:${digits}:${attempt}`,
    tailLength,
  );
  return buildSellerPrefixedBarcode(params.sellerNumber, tail);
}
