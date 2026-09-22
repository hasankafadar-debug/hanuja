import { describe, expect, it } from 'vitest'
import {
  buildCargoTrackingUrl,
  cargoProviderLabel,
} from '../../../api/domain/cargo-tracking'

describe('buildCargoTrackingUrl', () => {
  it('builds https links for verified carriers and encodes the tracking number', () => {
    expect(buildCargoTrackingUrl('yurtiçi', 'YK 123')).toBeNull()
    expect(buildCargoTrackingUrl('yurtiçi', 'YK123456')).toBe(
      'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=YK123456',
    )
    expect(buildCargoTrackingUrl('Aras', '1234567890123')).toBe(
      'https://kargotakip.araskargo.com.tr/mainpage.aspx?code=1234567890123',
    )
    expect(buildCargoTrackingUrl('sürat', 'SR-1')).toBe(
      'https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=SR-1',
    )
    expect(buildCargoTrackingUrl('mng', '42')).toBe('https://www.dhlecommerce.com.tr/gonderitakip')
    for (const url of [
      buildCargoTrackingUrl('ups', '1Z999'),
      buildCargoTrackingUrl('fedex', '123'),
      buildCargoTrackingUrl('dhl', '123'),
    ]) {
      expect(url).toMatch(/^https:\/\//)
    }
  })

  it('returns null for unknown carriers, empty numbers and injection attempts', () => {
    expect(buildCargoTrackingUrl('ptt', '123')).toBeNull()
    expect(buildCargoTrackingUrl('unknown', '123')).toBeNull()
    expect(buildCargoTrackingUrl(undefined, '123')).toBeNull()
    expect(buildCargoTrackingUrl('aras', '')).toBeNull()
    expect(buildCargoTrackingUrl('aras', '123&redirect=evil')).toBeNull()
    expect(buildCargoTrackingUrl('aras', 'x'.repeat(65))).toBeNull()
  })
})

describe('cargoProviderLabel', () => {
  it('maps known providers to display names and falls back gracefully', () => {
    expect(cargoProviderLabel('yurtiçi')).toBe('Yurtiçi Kargo')
    expect(cargoProviderLabel('PTT')).toBe('PTT Kargo')
    expect(cargoProviderLabel('unknown')).toBe('Kargo')
    expect(cargoProviderLabel(undefined)).toBe('Kargo')
    expect(cargoProviderLabel('Trendyol Express')).toBe('Trendyol Express')
  })
})
