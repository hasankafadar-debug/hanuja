import { createHash } from 'node:crypto'

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'i')
    .replace(/Ä°/g, 'I')
    .replace(/Ä±/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function cellText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  if (!text) return undefined
  // A few legacy exports were read through a Latin-1 path before reaching Excel.
  if (!/[ÃƒÃ„Ã…]/.test(text)) return text
  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8')
    return repaired.includes('ï¿½') ? text : repaired
  } catch {
    return text
  }
}

export function parseLocaleNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = cellText(value)
  if (!text) return undefined
  const numeric = text.replace(/[^0-9,.-]/g, '')
  const lastComma = numeric.lastIndexOf(','); const lastDot = numeric.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot >= 0 ? '.' : undefined
  const normalized = decimalSeparator ? numeric.replace(/[.,]/g, (token) => token === decimalSeparator ? '.' : '') : numeric
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseStock(value: unknown, textValues?: Record<string, number>): number | undefined {
  const text = normalizeText(cellText(value))
  if (text === 'stokta') return 10
  const configured = Object.entries(textValues ?? {}).find(([key]) => normalizeText(key) === text)
  if (configured) return configured[1]
  const number = parseLocaleNumber(value)
  return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined
}

export function stableHash(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort)
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)]))
    }
    return input
  }
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex')
}

export function splitImageUrls(value: unknown): string[] {
  const text = cellText(value)
  if (!text) return []
  const urls = text.match(/https?:\/\/[^\s;|,]+/gi)
  return [...new Set((urls?.length ? urls : text.split(/[\n;|]+/)).map((item) => item.trim()).filter(Boolean))]
}
