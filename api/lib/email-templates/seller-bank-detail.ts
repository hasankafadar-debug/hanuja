import { escapeHtml, greeting, heading, layout, paragraph } from './shared'

export function sellerBankDetailTemplate(input: {
  approved: boolean
  sellerName: string
  ibanMasked: string
}) {
  const subject = input.approved
    ? 'IBAN değişikliğiniz onaylandı'
    : 'IBAN değişikliği talebiniz alındı'
  const body = input.approved
    ? 'Yeni IBAN bilginiz ' +
      input.ibanMasked +
      ' için güvenlik onayı tamamlandı. Aktivasyon zamanı geldiğinde bu hesap kullanılacak.'
    : 'Yeni IBAN bilginiz ' +
      input.ibanMasked +
      ' için güvenlik bekleme süresi başlatıldı. Bu işlem size ait değilse destek ekibimizle hemen iletişime geçin.'
  return {
    subject,
    html: layout(
      subject,
      heading(subject) + greeting(input.sellerName) + paragraph(escapeHtml(body)),
    ),
    text: 'Merhaba ' + input.sellerName + ', ' + body,
  }
}
