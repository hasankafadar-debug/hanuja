const R2_ERROR_MESSAGE_MAP: Record<string, string> = {
  AccessDenied:
    "Dosya yükleme izni reddedildi. Medya yapılandırmasını ve erişim izinlerini kontrol edin.",
  SignatureDoesNotMatch:
    "Yükleme imzası doğrulanamadı. Lütfen tekrar deneyin; sorun sürerse medya ayarlarını kontrol edin.",
  ExpiredToken:
    "Yükleme bağlantısının süresi dolmuş. Lütfen dosyayı yeniden seçip tekrar deneyin.",
  RequestTimeout:
    "Dosya yükleme isteği zaman aşımına uğradı. İnternet bağlantınızı kontrol edip tekrar deneyin.",
  EntityTooLarge: "Dosya boyutu izin verilen sınırı aşıyor.",
  InvalidArgument:
    "Dosya yükleme isteği geçersiz. Lütfen dosyayı yeniden seçip tekrar deneyin.",
  InvalidDigest:
    "Dosya bütünlüğü doğrulanamadı. Lütfen dosyayı yeniden seçip tekrar deneyin.",
  NoSuchBucket:
    "Medya deposu bulunamadı. Lütfen sistem yöneticisine haber verin.",
  SlowDown: "Medya servisi şu anda yoğun. Lütfen birazdan tekrar deneyin.",
};

export interface MediaUploadAsset {
  id: string;
  url?: string | null;
}

export interface MediaUploadUrlPayload {
  asset: MediaUploadAsset;
  uploadUrl: string;
}

export interface ConfirmedMediaUploadAsset {
  id: string;
  url: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapApiData(value: unknown) {
  if (
    isRecord(value) &&
    "data" in value &&
    value.data !== undefined &&
    value.data !== null
  ) {
    return value.data;
  }

  return value;
}

function decodeXmlEntity(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanMessage(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function readAsset(value: unknown): MediaUploadAsset | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }

  return {
    id: value.id,
    url: typeof value.url === "string" && value.url.trim() ? value.url : null,
  };
}

function extractXmlTag(body: string, tagName: string) {
  const match = body.match(
    new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"),
  );
  return match?.[1] ? decodeXmlEntity(cleanMessage(match[1])) : null;
}

function extractJsonMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      message?: string;
      code?: string;
    };

    return {
      message:
        typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
            ? parsed.message
            : null,
      code: typeof parsed.code === "string" ? parsed.code : null,
    };
  } catch {
    return { message: null, code: null };
  }
}

export function getUploadStatusMessage(status: number, statusText?: string) {
  if (status === 401 || status === 403) {
    return "Dosya yükleme izni reddedildi. Oturumunuzu yenileyip tekrar deneyin.";
  }
  if (status === 404) {
    return "Yükleme hedefi bulunamadı. Medya deposu veya upload bağlantısı yapılandırmasını kontrol edin.";
  }
  if (status === 413) {
    return "Dosya boyutu izin verilen sınırı aşıyor.";
  }
  if (status === 415) {
    return "Bu dosya türü desteklenmiyor.";
  }
  if (status >= 500) {
    return "Medya servisi geçici olarak kullanılamıyor. Lütfen birazdan tekrar deneyin.";
  }

  const normalizedStatusText = cleanMessage(statusText ?? "");
  return normalizedStatusText
    ? `Dosya yükleme isteği başarısız oldu (${status} ${normalizedStatusText}).`
    : `Dosya yükleme isteği başarısız oldu (HTTP ${status}).`;
}

export function getPresignErrorMessage(body: unknown) {
  if (typeof body === "string" && body.trim()) return cleanMessage(body);
  if (body && typeof body === "object") {
    const candidate = body as { error?: string; message?: string };
    if (typeof candidate.error === "string" && candidate.error.trim())
      return cleanMessage(candidate.error);
    if (typeof candidate.message === "string" && candidate.message.trim())
      return cleanMessage(candidate.message);
  }

  return "Yükleme başlatılamadı.";
}

export function getConfirmErrorMessage(body: unknown) {
  if (typeof body === "string" && body.trim()) return cleanMessage(body);
  if (body && typeof body === "object") {
    const candidate = body as { error?: string; message?: string };
    if (typeof candidate.error === "string" && candidate.error.trim())
      return cleanMessage(candidate.error);
    if (typeof candidate.message === "string" && candidate.message.trim())
      return cleanMessage(candidate.message);
  }

  return "Yükleme onaylanamadı.";
}

export function getCorsOrNetworkMessage(error: unknown) {
  if (error instanceof TypeError) {
    return "Dosya yükleme isteği tarayıcı tarafından engellendi veya ağ bağlantısı kurulamadı. CORS ve medya yapılandırmasını kontrol edin.";
  }

  return "Yükleme sırasında bağlantı hatası oluştu.";
}

export function parseUploadFailure(params: {
  status: number;
  statusText?: string;
  bodyText?: string;
}) {
  const { status, statusText, bodyText } = params;
  const normalizedBody = cleanMessage(bodyText ?? "");
  const json = normalizedBody
    ? extractJsonMessage(normalizedBody)
    : { message: null, code: null };
  const xmlCode = normalizedBody ? extractXmlTag(normalizedBody, "Code") : null;
  const xmlMessage = normalizedBody
    ? extractXmlTag(normalizedBody, "Message")
    : null;
  const code = json.code ?? xmlCode;
  const mappedByCode = code ? R2_ERROR_MESSAGE_MAP[code] : null;

  if (mappedByCode) return mappedByCode;
  if (json.message) return cleanMessage(json.message);
  if (xmlMessage) return xmlMessage;

  return getUploadStatusMessage(status, statusText);
}

export function parseUploadUrlPayload(body: unknown): MediaUploadUrlPayload {
  const data = unwrapApiData(body);

  if (!isRecord(data)) {
    throw new Error(
      "Yükleme başlatılamadı. Sunucu geçerli bir upload yanıtı döndürmedi.",
    );
  }

  const asset = readAsset(data.asset);
  if (!asset) {
    throw new Error("Yükleme başlatılamadı. Medya kaydı oluşturulamadı.");
  }

  if (typeof data.uploadUrl !== "string" || !data.uploadUrl.trim()) {
    throw new Error(
      "Yükleme başlatılamadı. Sunucu upload bağlantısını döndürmedi.",
    );
  }

  return {
    asset,
    uploadUrl: data.uploadUrl,
  };
}

export function parseConfirmPayload(
  body: unknown,
  fallbackAsset: MediaUploadAsset,
): ConfirmedMediaUploadAsset {
  const data = unwrapApiData(body);
  const confirmedAsset = readAsset(data);
  const url = confirmedAsset?.url ?? fallbackAsset.url;

  if (!url) {
    throw new Error("Yükleme onaylandı ancak medya URL adresi alınamadı.");
  }

  return {
    id: confirmedAsset?.id ?? fallbackAsset.id,
    url,
  };
}
