import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const smtp = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn() }))
vi.mock('../../api/node_modules/nodemailer/lib/nodemailer.js', () => ({
  default: { createTransport: smtp.create },
}))

beforeEach(() => {
  vi.resetModules()
  smtp.create.mockReturnValue({ sendMail: smtp.send })
  smtp.send.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

function production() {
  vi.stubEnv('NODE_ENV', 'production')
  for (const [key, value] of Object.entries({
    SMTP_HOST: 'smtp.resend.com',
    SMTP_PORT: '465',
    SMTP_USER: 'resend',
    SMTP_PASS: 'test-only',
    SMTP_FROM: 'Hanuja <noreply@example.test>',
    EMAIL_FROM_NOREPLY: '',
    EMAIL_FROM_FATURA: '',
    EMAIL_FROM_KAMPANYA: '',
  }))
    vi.stubEnv(key, value)
}

describe('production mail transport', () => {
  it('fails closed when SMTP is missing instead of using JSON transport', async () => {
    production()
    vi.stubEnv('SMTP_PASS', '')
    const { sendEmail } = await import('../../api/lib/mailer')
    await expect(
      sendEmail({ to: 'test@example.test', subject: 'Test', html: 'Test' }),
    ).rejects.toThrow('SMTP_CONFIG_MISSING')
    expect(smtp.send).not.toHaveBeenCalled()
  })
  it('rejects malformed sender override without exposing its value', async () => {
    production()
    vi.stubEnv('EMAIL_FROM_NOREPLY', 'invalid-private-value')
    const { sendEmail } = await import('../../api/lib/mailer')
    await expect(
      sendEmail({ to: 'test@example.test', subject: 'Test', html: 'Test' }),
    ).rejects.toThrow('SMTP_CONFIG_INVALID:EMAIL_FROM_NOREPLY')
    expect(smtp.send).not.toHaveBeenCalled()
  })
  it('validates mailbox and named mailbox formats, rejecting injection', async () => {
    const { isValidFromAddress } = await import('../../api/lib/mailer')
    expect(isValidFromAddress('Hanuja <noreply@example.test>')).toBe(true)
    expect(isValidFromAddress('noreply@example.test')).toBe(true)
    for (const value of [
      'not-an-address',
      'x@example.test\r\nBcc: x@y.test',
      'Name <x@y.test',
      'x@y.test>',
    ])
      expect(isValidFromAddress(value)).toBe(false)
  })
  it('captures acceptance and provider ID and rejects non-accepted recipients', async () => {
    production()
    smtp.send.mockResolvedValue({
      accepted: ['test@example.test'],
      rejected: [],
      messageId: '<m@hanuja.com.tr>',
      response: '250 12345678-1234-1234-1234-123456789abc',
    })
    const { sendEmail } = await import('../../api/lib/mailer')
    expect(
      await sendEmail({
        to: 'test@example.test',
        subject: 'Test',
        html: 'Test',
      }),
    ).toMatchObject({
      transport: 'smtp',
      providerMessageId: '12345678-1234-1234-1234-123456789abc',
    })
    smtp.send.mockResolvedValue({
      accepted: [],
      rejected: ['test@example.test'],
    })
    await expect(
      sendEmail({ to: 'test@example.test', subject: 'Test', html: 'Test' }),
    ).rejects.toThrow('SMTP_RECIPIENT_REJECTED')
  })
})
