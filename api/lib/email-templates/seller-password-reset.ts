import { PLATFORM_LEGAL_INFO } from '../platform-info'

export interface SellerPasswordResetTemplateInput {
  email: string
  resetUrl: string
}

export function sellerPasswordResetTemplate(input: SellerPasswordResetTemplateInput) {
  const subject = 'Şifre sıfırlama bağlantınız'
  const html = `<!DOCTYPE html>
<html lang="tr">
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#111;">Şifre sıfırlama</h1>
    <p style="margin:0 0 16px;color:#444;">Merhaba ${input.email},</p>
    <p style="margin:0 0 24px;color:#444;">Aşağıdaki bağlantı ile şifrenizi sıfırlayabilirsiniz.</p>
    <p style="margin:0 0 24px;"><a href="${input.resetUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;">Şifreyi sıfırla</a></p>
    <p style="margin:0;color:#666;font-size:13px;">Bu bağlantı kısa süre geçerlidir. Talep sizden gelmediyse bu e-postayı yok sayabilirsiniz.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="margin:0;color:#888;font-size:12px;">Destek: ${PLATFORM_LEGAL_INFO.supportEmail}</p>
  </div>
</body>
</html>`
  const text = `Merhaba ${input.email}, şifrenizi sıfırlamak için şu bağlantıyı kullanın: ${input.resetUrl}`
  return { subject, html, text }
}
