export type ModerationField =
  | 'name'
  | 'description'
  | 'shortDescription'
  | 'story'
  | 'careInstructions'

export type ModerationFindingType =
  | 'phone'
  | 'email'
  | 'iban'
  | 'url'
  | 'social'
  | 'address'

export interface ModerationFinding {
  type: ModerationFindingType
  field: ModerationField
  match: string
  excerpt: string
  reason: string
}

interface ProductContentInput {
  name?: string | null
  description?: string | null
  shortDescription?: string | null
  story?: string | null
  careInstructions?: string | null
}

const PHONE_REGEX = /(?:\+?90|0)?\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const IBAN_REGEX = /\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi
const URL_REGEX = /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|co|io|shop|store|app|tr))(?:\/\S*)?/gi
const SOCIAL_REGEX = /\b(?:instagram|insta|whatsapp|telegram|tiktok|facebook|twitter|x\.com|linkedin|youtube)\b|@\w{3,}/gi
const ADDRESS_REGEX = /\b(?:mah(?:alle)?\.?|sok(?:ak)?\.?|cad(?:de)?\.?|bulvar[ıi]?|no\s*:|kat\s*:|daire|apt\.?|apartman|adres)\b/gi

const RULES: Array<{
  type: ModerationFindingType
  regex: RegExp
  reason: string
}> = [
  { type: 'phone', regex: PHONE_REGEX, reason: 'Telefon bilgisi içeriyor' },
  { type: 'email', regex: EMAIL_REGEX, reason: 'E-posta bilgisi içeriyor' },
  { type: 'iban', regex: IBAN_REGEX, reason: 'IBAN bilgisi içeriyor' },
  { type: 'url', regex: URL_REGEX, reason: 'Harici bağlantı içeriyor' },
  { type: 'social', regex: SOCIAL_REGEX, reason: 'Sosyal medya veya doğrudan iletişim çağrısı içeriyor' },
  { type: 'address', regex: ADDRESS_REGEX, reason: 'Adres sinyali içeriyor' },
]

export function createContentScannerService() {
  function scanProductContent(input: ProductContentInput): {
    flagged: boolean
    findings: ModerationFinding[]
  } {
    const findings: ModerationFinding[] = []

    const fields = Object.entries(input) as Array<[ModerationField, string | null | undefined]>
    for (const [field, value] of fields) {
      const text = value?.trim()
      if (!text) continue

      for (const rule of RULES) {
        const regex = new RegExp(rule.regex.source, rule.regex.flags)
        const seen = new Set<string>()
        for (const match of text.matchAll(regex)) {
          const matchedText = match[0]?.trim()
          if (!matchedText || seen.has(`${rule.type}:${matchedText.toLowerCase()}`)) continue
          seen.add(`${rule.type}:${matchedText.toLowerCase()}`)

          findings.push({
            type: rule.type,
            field,
            match: matchedText,
            excerpt: buildExcerpt(text, match.index ?? 0, matchedText.length),
            reason: rule.reason,
          })
        }
      }
    }

    return {
      flagged: findings.length > 0,
      findings,
    }
  }

  return {
    scanProductContent,
  }
}

function buildExcerpt(text: string, start: number, length: number) {
  const excerptStart = Math.max(0, start - 24)
  const excerptEnd = Math.min(text.length, start + length + 24)
  return text.slice(excerptStart, excerptEnd).trim()
}

export type ContentScannerService = ReturnType<typeof createContentScannerService>
