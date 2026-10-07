import { greeting, heading, layout, paragraph, renderCta } from './shared'

export function sellerApprovalTemplate(input: { email: string; panelUrl: string }) {
  const subject = 'Satıcı hesabınız aktif edildi'
  return {
    subject,
    html: layout(
      subject,
      heading('Satıcı hesabınız hazır') +
        greeting(input.email) +
        paragraph(
          'Başvurunuz onaylandı. Satıcı panelinize aşağıdaki bağlantıdan giriş yapabilirsiniz.',
        ) +
        renderCta('Satıcı paneline git', input.panelUrl) +
        paragraph('Başvuru sırasında kullandığınız hesap bilgilerinizle giriş yapabilirsiniz.'),
    ),
    text:
      'Satıcı hesabınız aktif edildi. Başvuru sırasında kullandığınız hesap bilgilerinizle giriş yapabilirsiniz. Panel: ' +
      input.panelUrl,
  }
}
