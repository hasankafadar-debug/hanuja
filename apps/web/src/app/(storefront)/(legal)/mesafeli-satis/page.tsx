import type { Metadata } from 'next'
import { buildPublicLegalDocumentContext, renderLegalDocuments } from '@hanuja/api/lib/legal-documents'
import LegalDocumentHtml from '@/components/legal-document-html'
import { LegalEntityBox } from '@/components/storefront/legal-entity-box'

export const metadata: Metadata = {
  title: 'Mesafeli Satış Sözleşmesi | Hanuja',
  description: 'Hanuja siparişlerinde kullanılan mesafeli satış sözleşmesinin genel örneği.',
  robots: { index: true, follow: true },
}

export default function MesafeliSatisPage() {
  const preview = renderLegalDocuments(buildPublicLegalDocumentContext())

  return (
    <>
      <LegalEntityBox />
      <p className="mb-6 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Bu sayfa, checkout sırasında adres ve sipariş bilgilerinizle dinamik olarak oluşturulan
        mesafeli satış sözleşmesinin genel örneğini gösterir.
      </p>
      <LegalDocumentHtml html={preview.distanceSalesHtml} />
    </>
  )
}
