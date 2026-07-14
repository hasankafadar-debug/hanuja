/**
 * Seed guard — yıkıcı seed'in yanlış (uzak/üretim) veritabanına çalışmasını engeller.
 *
 * `isLocalDatabaseUrl` yalnızca localhost / 127.0.0.1 / ::1 host'ları için true döner.
 * Şema: postgres:// veya postgresql://. Bozuk/bilinmeyen URL → false (fail-closed).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function isLocalDatabaseUrl(url: string): boolean {
  if (!url || url.trim() === '') return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // Parse edilemeyen (garbage) URL → güvenli varsayılan reddetmektir.
    return false
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return false
  }

  // WHATWG URL, IPv6 host'u köşeli parantezle döndürür ("[::1]") — parantezi soyar.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return LOCAL_HOSTS.has(host)
}
