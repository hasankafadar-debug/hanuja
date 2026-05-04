import { PLATFORM_LEGAL_INFO } from '../platform-info'

export function emailVerificationTemplate(input: { email: string; verificationUrl: string }) {
  const subject = 'E-posta adresinizi dogrulayin'

  const html = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:#1a1a1a;padding:24px 32px;">
              <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">Hanuja</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">E-posta adresinizi dogrulayin</h2>
              <p style="margin:0 0 16px;color:#444;">Merhaba ${input.email},</p>
              <p style="margin:0 0 24px;color:#555;line-height:1.6;">
                Hanuja hesabinizi kullanmaya devam etmek icin e-posta adresinizi dogrulamaniz gerekiyor.
              </p>
              <p style="margin:0 0 24px;">
                <a
                  href="${input.verificationUrl}"
                  style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;"
                >
                  E-posta adresimi dogrula
                </a>
              </p>
              <p style="margin:0;color:#777;font-size:13px;line-height:1.5;">
                Buton calismazsa su baglantiyi tarayiciniza yapistirabilirsiniz:<br />
                <a href="${input.verificationUrl}" style="color:#1a1a1a;">${input.verificationUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;">
                Bu e-posta Hanuja tarafindan otomatik olarak gonderilmistir.
                Sorulariniz icin <a href="mailto:${PLATFORM_LEGAL_INFO.supportEmail}" style="color:#999999;">${PLATFORM_LEGAL_INFO.supportEmail}</a> adresine ulasabilirsiniz.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const text = `Merhaba ${input.email}, hesabinizi kullanmaya devam etmek icin e-posta adresinizi dogrulayin: ${input.verificationUrl}`

  return { subject, html, text }
}
