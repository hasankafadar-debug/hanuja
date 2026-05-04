import type { Metadata } from 'next'
import { buildPublicLegalDocumentContext, renderLegalDocuments } from '@hanuja/api/lib/legal-documents'
import LegalDocumentHtml from '@/components/legal-document-html'
import { LegalEntityBox } from '@/components/storefront/legal-entity-box'

export const metadata: Metadata = {
  title: 'Ön Bilgilendirme Formu | Hanuja',
  description: 'Hanuja siparişleri için checkout sırasında oluşturulan ön bilgilendirme formunun genel örneği.',
  robots: { index: true, follow: true },
}

export default function OnBilgilendirmePage() {
  const preview = renderLegalDocuments(buildPublicLegalDocumentContext())

  return (
    <>
      <LegalEntityBox />
      <p className="mb-6 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Bu sayfa, sipariş öncesinde adres ve ödeme bilgilerinize göre hazırlanan ön bilgilendirme
        formunun genel örneğini gösterir.
      </p>
      <LegalDocumentHtml html={preview.preInformationHtml} />
    </>
  )
}
