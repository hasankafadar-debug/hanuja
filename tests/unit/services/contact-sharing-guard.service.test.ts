import { describe, expect, it } from 'vitest'
import {
  CONTACT_SHARING_BLOCK_MESSAGE,
  assertNoContactSharing,
  scanContactSharing,
} from '../../../api/services/contact-sharing-guard.service'

describe('contact-sharing-guard.service', () => {
  it('flags contact and off-platform signals', () => {
    const findings = scanContactSharing(
      'Bana 0555 123 45 67, hello@example.com, TR120006200119000006672315, instagram @magaza veya www.ornek.com üzerinden ulaş. Adres: Test Mah. No:1',
    )

    expect(findings.map((finding) => finding.type)).toEqual(
      expect.arrayContaining(['phone', 'email', 'iban', 'url', 'social', 'address']),
    )
  })

  it('throws before a message can be persisted', () => {
    expect(() => assertNoContactSharing('WhatsApp için 0555 123 45 67 yazın')).toThrow(
      CONTACT_SHARING_BLOCK_MESSAGE,
    )
  })

  it('allows clean marketplace messages', () => {
    expect(() =>
      assertNoContactSharing('Ürünü teslim aldım, paket içeriğini kontrol edip dönüş yapacağım.'),
    ).not.toThrow()
  })
})
