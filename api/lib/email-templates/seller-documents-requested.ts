import { escapeHtml, greeting, heading, layout, paragraph, renderCta } from './shared'

export function sellerDocumentsRequestedTemplate(input: {
  email: string
  panelUrl: string
  note?: string
  requiredDocTypes: string[]
}) {
  const subject = 'Belgeleriniz talep edildi'
  const docList = input.requiredDocTypes.map((item) => '<li>' + escapeHtml(item) + '</li>').join('')
  return {
    subject,
    html: layout(
      subject,
      heading('Belgelerinizi yükleyin') +
        greeting(input.email) +
        paragraph('Başvurunuz için aşağıdaki belgeleri yüklemeniz gerekiyor:') +
        '<ul style="margin:0 0 24px;padding-left:20px;color:#444;">' +
        docList +
        '</ul>' +
        (input.note ? paragraph('<strong>Not:</strong> ' + escapeHtml(input.note)) : '') +
        renderCta('Belge yükleme alanına git', input.panelUrl),
    ),
    text:
      'Merhaba ' +
      input.email +
      ', şu belgeler talep edildi: ' +
      input.requiredDocTypes.join(', ') +
      (input.note ? '\nNot: ' + input.note : '') +
      '\nPanel: ' +
      input.panelUrl,
  }
}
