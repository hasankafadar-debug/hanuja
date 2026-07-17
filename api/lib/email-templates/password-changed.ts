import { PLATFORM_LEGAL_INFO } from '../platform-info'

export interface PasswordChangedTemplateInput {
  changedAt: Date
}

const ISTANBUL_TIME_ZONE = 'Europe/Istanbul'

function formatChangedAt(changedAt: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIME_ZONE,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(changedAt)
}

/**
 * Security notification — sent after a password change (reset or manual).
 * Intentionally contains no links/buttons (phishing hygiene).
 */
export function passwordChangedTemplate(input: PasswordChangedTemplateInput) {
  const formattedDate = formatChangedAt(input.changedAt)
  const subject = 'Şifreniz Değiştirildi'
  const html = `<!DOCTYPE html>
<html lang="tr">
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#111;">Şifreniz Değiştirildi</h1>
    <p style="margin:0 0 16px;color:#444;">Hesabınızın şifresi <strong>${formattedDate}</strong> tarihinde değiştirildi.</p>
    <p style="margin:0;color:#444;">Bu işlemi siz yapmadıysanız lütfen derhal ${PLATFORM_LEGAL_INFO.supportEmail} adresinden bizimle iletişime geçin.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="margin:0;color:#888;font-size:12px;">Destek: ${PLATFORM_LEGAL_INFO.supportEmail}</p>
  </div>
</body>
</html>`
  const text = `Hesabınızın şifresi ${formattedDate} tarihinde değiştirildi. Bu işlemi siz yapmadıysanız lütfen derhal ${PLATFORM_LEGAL_INFO.supportEmail} adresinden bizimle iletişime geçin.`
  return { subject, html, text }
}
