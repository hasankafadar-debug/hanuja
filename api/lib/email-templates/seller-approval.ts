import { greeting, heading, layout, paragraph, renderCta } from './shared'

export function sellerApprovalTemplate(input: { email: string; panelUrl: string }) {
  const subject = 'Tasarımcı hesabınız aktif edildi'
  return {
    subject,
    html: layout(
      subject,
      heading('Tasarımcı hesabınız hazır') +
        greeting(input.email) +
        paragraph(
          'Başvurunuz onaylandı. Tasarımcı panelinize aşağıdaki bağlantıdan giriş yapabilirsiniz.',
        ) +
        renderCta('Tasarımcı paneline git', input.panelUrl) +
        paragraph('Başvuru sırasında kullandığınız hesap bilgilerinizle giriş yapabilirsiniz.'),
    ),
    text:
      'Tasarımcı hesabınız aktif edildi. Başvuru sırasında kullandığınız hesap bilgilerinizle giriş yapabilirsiniz. Panel: ' +
      input.panelUrl,
  }
}
