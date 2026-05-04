import { ValidationError } from '../lib/errors'

export type ContactSharingFindingType =
  | 'email'
  | 'phone'
  | 'iban'
  | 'url'
  | 'social'
  | 'address'

export interface ContactSharingFinding {
  type: ContactSharingFindingType
  match: string
}

const RULES: Array<{ type: ContactSharingFindingType; regex: RegExp }> = [
  { type: 'email', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'phone', regex: /(?:\+?90|0)?\s*5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g },
  { type: 'iban', regex: /\bTR\d{2}(?:\s?\d{4}){5}\s?\d{2}\b/gi },
  { type: 'url', regex: /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|co|io|shop|store|app|tr))(?:\/\S*)?/gi },
  { type: 'social', regex: /\b(?:instagram|insta|whatsapp|telegram|tiktok|facebook|twitter|x\.com|linkedin|youtube)\b|@\w{3,}/gi },
  { type: 'address', regex: /\b(?:mah(?:alle)?\.?|sok(?:ak)?\.?|cad(?:de)?\.?|bulvar[ıi]?|no\s*:|kat\s*:|daire|apt\.?|apartman|adres)\b/gi },
]

export const CONTACT_SHARING_BLOCK_MESSAGE =
  'İletişim bilgisi paylaşamazsınız. Lütfen konuşmayı platform içinde sürdürün.'

export function scanContactSharing(text: string): ContactSharingFinding[] {
  const findings: ContactSharingFinding[] = []
  const seen = new Set<string>()

  for (const rule of RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags)
    for (const match of text.matchAll(regex)) {
      const value = match[0]?.trim()
      if (!value) continue
      const key = `${rule.type}:${value.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({ type: rule.type, match: value })
    }
  }

  return findings
}

export function assertNoContactSharing(text: string) {
  const findings = scanContactSharing(text)
  if (findings.length > 0) {
    throw new ValidationError(CONTACT_SHARING_BLOCK_MESSAGE)
  }
}
