/**
 * Hanuja SMTP mailer using Nodemailer.
 *
 * Configuration is read from environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * In development, if no SMTP credentials are set, the mailer logs
 * the email to the console instead of throwing, so the app boots safely.
 */
import nodemailer, { type Transporter } from 'nodemailer'

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

let _transport: Transporter | null = null

function getTransport(): Transporter {
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
    secure: port === 465,
    auth: { user, pass },
  })

  return _transport
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const from = process.env['SMTP_FROM'] ?? 'Hanuja <no-reply@hanuja.com>'
  const transport = getTransport()

  const info = await transport.sendMail({
    from,
    to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  })

  // In dev (jsonTransport), log the message instead of sending
  if ((info as { message?: string }).message) {
    const parsed = JSON.parse((info as { message: string }).message) as {
      subject?: string
      to?: unknown
    }
    console.log(
      `[mailer] DEV — email not sent. Subject: "${parsed.subject}", To: ${JSON.stringify(parsed.to)}`,
    )
  }
}
