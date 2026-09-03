import { describe, expect, it } from 'vitest'
import {
  DISTANCE_SALES_DOCUMENT_VERSION,
  PRE_INFORMATION_DOCUMENT_VERSION,
  buildPublicLegalDocumentContext,
  hashLegalDocumentHtml,
  renderLegalDocuments,
} from '../../api/lib/legal-documents'

describe('legal documents', () => {
  it('renders versioned distance sales and pre-information documents with marketplace role language', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    expect(bundle.distanceSalesVersion).toBe(DISTANCE_SALES_DOCUMENT_VERSION)
    expect(bundle.preInformationVersion).toBe(PRE_INFORMATION_DOCUMENT_VERSION)

    expect(bundle.distanceSalesHtml).toContain('Belge Sürümü')
    expect(bundle.distanceSalesHtml).toContain('elektronik ticaret aracı hizmet sağlayıcı')
    expect(bundle.distanceSalesHtml).toContain('Satıcı Sorumlulukları')
    expect(bundle.distanceSalesHtml).toContain('Alıcı Beyan ve Sorumlulukları')
    expect(bundle.distanceSalesHtml).toContain('Uyuşmazlık')

    expect(bundle.preInformationHtml).toContain('Teknik Sipariş Adımları')
    expect(bundle.preInformationHtml).toContain('Platformun Rolü ve Sorumluluk Sınırı')
  })

  it('embeds the active document versions in both order snapshots', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    expect(bundle.distanceSalesHtml).toContain(
      `<strong>Belge Sürümü:</strong> ${DISTANCE_SALES_DOCUMENT_VERSION}`,
    )
    expect(bundle.preInformationHtml).toContain(
      `<strong>Belge Sürümü:</strong> ${PRE_INFORMATION_DOCUMENT_VERSION}`,
    )
    expect(bundle.distanceSalesVersion).not.toBe('distance-sales-2026-06-16-v1')
    expect(bundle.preInformationVersion).not.toBe('pre-information-2026-06-16-v1')
  })

  it('uses the 2026 return shipping posture and does not keep old electronics exceptions', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())
    const combinedHtml = `${bundle.distanceSalesHtml}\n${bundle.preInformationHtml}`

    expect(combinedHtml).toContain('01.01.2026')
    expect(combinedHtml).toContain('tüketici iade masraflarından sorumlu tutulamaz')
    expect(combinedHtml).not.toContain('telefon, akıllı saat, tablet ve bilgisayar')
    expect(combinedHtml).not.toContain('iade kargo müşteriye aittir')
  })

  it('states the personalized-goods withdrawal exception without limiting defective-goods remedies', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin')
      expect(html).toContain("Mesafeli Sözleşmeler Yönetmeliği'ndeki cayma hakkı istisnaları")
      expect(html).toContain('Ürün bu nitelikteyse ve mevzuattaki koşullar oluşmuşsa cayma hakkı kullanılamayabilir')
      expect(html).toContain('Ayıplı veya sözleşmeye aykırı ürünlere ilişkin tüketicinin mevzuattan doğan')
      expect(html).toContain('yasal hakları saklıdır')
      expect(html).toContain('cayma hakkı istisnası bu hakları ortadan kaldırmaz')
    }
  })

  it('hashes rendered HTML deterministically for legal acceptance evidence', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())
    const firstHash = hashLegalDocumentHtml(bundle.distanceSalesHtml)
    const secondHash = hashLegalDocumentHtml(bundle.distanceSalesHtml)

    expect(firstHash).toBe(secondHash)
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
  })
})
