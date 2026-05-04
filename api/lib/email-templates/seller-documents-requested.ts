import { PLATFORM_LEGAL_INFO } from '../platform-info'

export function sellerDocumentsRequestedTemplate(input: {
  email: string
  panelUrl: string
  note?: string
  requiredDocTypes: string[]
}) {
  const subject = 'Belgeleriniz talep edildi'
  const docList = input.requiredDocTypes.map((item) => `<li>${item}</li>`).join('')
  const html = `<!DOCTYPE html>
<html lang="tr">
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#111;">Belgelerinizi yükleyin</h1>
    <p style="margin:0 0 16px;color:#444;">Merhaba ${input.email},</p>
    <p style="margin:0 0 16px;color:#444;">Başvurunuz için aşağıdaki belgeleri yüklemeniz gerekiyor:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#444;">${docList}</ul>
    ${input.note ? `<p style="margin:0 0 16px;color:#444;"><strong>Not:</strong> ${input.note}</p>` : ''}
    <p style="margin:0 0 24px;"><a href="${input.panelUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;">Belge yükleme alanına git</a></p>
    <p style="margin:0;color:#666;font-size:13px;">Destek ekibimiz size yardımcı olabilir.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <p style="margin:0;color:#888;font-size:12px;">Destek: ${PLATFORM_LEGAL_INFO.supportEmail}</p>
  </div>
</body>
</html>`
  const text = `Merhaba ${input.email}, şu belgeler talep edildi: ${input.requiredDocTypes.join(', ')}. Panel: ${input.panelUrl}`
  return { subject, html, text }
}
