/**
 * Hanuja SMTP mailer using Nodemailer.
 *
 * Configuration is read from environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Per-category from-address overrides (each falls back to SMTP_FROM, then a
 * hardcoded default):
 *   EMAIL_FROM_NOREPLY, EMAIL_FROM_FATURA, EMAIL_FROM_KAMPANYA
 *
 * In development, if no SMTP credentials are set, the mailer logs
 * the email to the console instead of throwing, so the app boots safely.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import { PLATFORM_LEGAL_INFO } from './platform-info'

export type EmailFromCategory = 'noreply' | 'fatura' | 'kampanya'

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  replyTo?: string
  /** Which from-address to use. Defaults to 'noreply'. */
  fromCategory?: EmailFromCategory
  /** Prevent recipient details from being written by the development transport. */
  suppressDevelopmentRecipientLog?: boolean
  headers?: Record<string, string>
  messageId?: string
}

export interface EmailSendResult {
  messageId: string
  providerMessageId: string | null
  transport: 'smtp' | 'development'
}

export function assertProductionMailConfig(category?: EmailFromCategory): void {
  if (process.env.NODE_ENV !== 'production') return
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter(
    (key) => !process.env[key]?.trim(),
  )
  if (missing.length)
    throw new Error(`SMTP_CONFIG_MISSING: ${missing.join(', ')}`)
  const port = Number(process.env.SMTP_PORT ?? '587')
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('SMTP_PORT_INVALID')
  const senderKeys = category
    ? ['SMTP_FROM', CATEGORY_ENV_VAR[category]]
    : [
        'SMTP_FROM',
        'EMAIL_FROM_NOREPLY',
        'EMAIL_FROM_FATURA',
        'EMAIL_FROM_KAMPANYA',
      ]
  for (const key of senderKeys) {
    const value = process.env[key]?.trim()
    if (value && !isValidFromAddress(value))
      throw new Error(`SMTP_CONFIG_INVALID:${key}`)
  }
}

export function isValidFromAddress(value: string): boolean {
  if (/[\r\n]/.test(value)) return false
  return (
    /^(?:[^<>,@]+\s+<)?[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+>?$/.test(value) &&
    value.includes('<') === value.endsWith('>')
  )
}

const CATEGORY_ENV_VAR: Record<EmailFromCategory, string> = {
  noreply: 'EMAIL_FROM_NOREPLY',
  fatura: 'EMAIL_FROM_FATURA',
  kampanya: 'EMAIL_FROM_KAMPANYA',
}

export function resolveFromAddress(category: EmailFromCategory): string {
  return (
    process.env[CATEGORY_ENV_VAR[category]]?.trim() ||
    process.env['SMTP_FROM']?.trim() ||
    `Hanuja <${PLATFORM_LEGAL_INFO.transactionalEmail}>`
  )
}

let _transport: Transporter | null = null

function getTransport(category: EmailFromCategory): Transporter {
  assertProductionMailConfig(category)
  if (_transport) return _transport

  const host = process.env['SMTP_HOST']
  const port = parseInt(process.env['SMTP_PORT'] ?? '587', 10)
  const user = process.env['SMTP_USER']
  const pass = process.env['SMTP_PASS']

  if (!host || !user || !pass) {
    // Dev fallback — use Nodemailer's built-in test transport stub
    _transport = nodemailer.createTransport({ jsonTransport: true })
    return _transport
  }

  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465 || port === 2465,
    requireTLS: port !== 465 && port !== 2465,
    auth: { user, pass },
    // Reuse a warm connection across sends instead of a fresh TLS handshake
    // + AUTH per email — the first send still pays full connection cost, but
    // repeat sends within maxMessages/keepalive reuse the open socket.
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Fail fast instead of hanging the caller (seller OTP send is awaited
    // synchronously inside the login request).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })

  return _transport
}

export async function sendEmail(
  options: SendEmailOptions,
): Promise<EmailSendResult> {
  const from = resolveFromAddress(options.fromCategory ?? 'noreply')
  const transport = getTransport(options.fromCategory ?? 'noreply')

  const info = await transport.sendMail({
    from,
    to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    subject: options.subject,
    html: options.html,
    text: options.text,
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.messageId ? { messageId: options.messageId } : {}),
  })

  const development =
    !process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS
  if (!development && (!info.accepted?.length || info.rejected?.length)) {
    throw new Error('SMTP_RECIPIENT_REJECTED')
  }

  // In dev (jsonTransport), log the message instead of sending
  if (
    process.env.NODE_ENV !== 'production' &&
    !options.suppressDevelopmentRecipientLog &&
    (info as { message?: string }).message
  ) {
    const parsed = JSON.parse((info as { message: string }).message) as {
      subject?: string
      to?: unknown
    }
    console.log('[mail:dev]', parsed.subject, '->', JSON.stringify(parsed.to))
  }
  return {
    messageId: String(info.messageId ?? options.messageId ?? ''),
    providerMessageId:
      process.env.SMTP_HOST === 'smtp.resend.com'
        ? (String(info.response ?? '').match(
            /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
          )?.[0] ?? null)
        : null,
    transport: development ? 'development' : 'smtp',
  }
}
