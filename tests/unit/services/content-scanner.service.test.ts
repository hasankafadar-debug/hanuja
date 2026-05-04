import { describe, expect, it } from 'vitest'
import { createContentScannerService } from '../../../api/services/content-scanner.service'

describe('content-scanner.service', () => {
  const scanner = createContentScannerService()

  it('flags phone, email, iban, url and address-like text', () => {
    const result = scanner.scanProductContent({
      name: 'El yapımı sehpa',
      description: 'Detay için 0555 123 45 67 veya hello@example.com üzerinden ulaşın.',
      shortDescription: 'IBAN TR120006200119000006672315 ile kapora alırım.',
      story: 'Adres: Moda Mah. Test Sok. No:12 Kadıköy',
      careInstructions: 'Instagram @atelierornek ve www.ornekdukkan.com bilgileri burada.',
    })

    expect(result.flagged).toBe(true)
    expect(result.findings.map((finding) => finding.type)).toEqual(
      expect.arrayContaining(['phone', 'email', 'iban', 'url', 'social', 'address']),
    )
  })

  it('does not flag clean marketplace copy', () => {
    const result = scanner.scanProductContent({
      name: 'Masif meşe orta sehpa',
      description: 'Doğal yağ ile korunan, salon kullanımına uygun el yapımı orta sehpa.',
      shortDescription: 'Mat vernikli yüzey',
      story: 'Her parça damar yapısına göre tek tek seçilir.',
      careInstructions: 'Nemli bezle silin, direkt güneşte uzun süre bırakmayın.',
    })

    expect(result.flagged).toBe(false)
    expect(result.findings).toHaveLength(0)
  })
})
