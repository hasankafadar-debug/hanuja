const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'br'])
const STRIP_WITH_CONTENT_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'noscript']

export function sanitizeBlogHtml(input: string | null | undefined): string {
  if (!input) return ''

  let html = input

  for (const tag of STRIP_WITH_CONTENT_TAGS) {
    const blockPattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'giu')
    const selfClosingPattern = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'giu')
    html = html.replace(blockPattern, '')
    html = html.replace(selfClosingPattern, '')
  }

  html = html.replace(/<!--[\s\S]*?-->/g, '')

  return html.replace(/<[^>]*>/g, (tagSource) => sanitizeTag(tagSource))
}

function sanitizeTag(tagSource: string): string {
  const match = tagSource.match(/^<\s*(\/)?\s*([a-z0-9-]+)([^>]*)>/i)
  if (!match) return ''

  const [, closingSlash, rawTagName, rawAttrs = ''] = match
  const tagName = (rawTagName ?? '').toLowerCase()
  if (!ALLOWED_TAGS.has(tagName)) return ''

  const isClosing = Boolean(closingSlash)
  if (tagName === 'br') return '<br />'
  if (isClosing) return `</${tagName}>`

  if (tagName !== 'a') {
    return `<${tagName}>`
  }

  const hrefMatch = rawAttrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
  const hrefCandidate = hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? ''
  const href = sanitizeInternalHref(hrefCandidate)

  return href ? `<a href="${escapeHtmlAttribute(href)}">` : '<a>'
}

function sanitizeInternalHref(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (!trimmed.startsWith('/')) return ''
  if (trimmed.startsWith('//')) return ''
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return ''
  return trimmed
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
