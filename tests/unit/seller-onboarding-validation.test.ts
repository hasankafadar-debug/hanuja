import { describe, expect, it } from 'vitest'
import {
  getTaxNumberFieldMeta,
  isValidPhone,
  isValidTaxNumber,
  normalizePhone,
  normalizeTaxNumber,
  validateContactStep,
} from '../../apps/seller-panel/src/lib/onboarding'

describe('seller onboarding validation', () => {
  it('accepts 11 digit TCKN for individual and sole proprietorship', () => {
    expect(isValidTaxNumber('individual', '12345678901')).toBe(true)
    expect(isValidTaxNumber('sole_proprietorship', '12345678901')).toBe(true)
  })

  it('rejects invalid TCKN length for individual and sole proprietorship', () => {
    expect(isValidTaxNumber('individual', '1234567890')).toBe(false)
    expect(isValidTaxNumber('sole_proprietorship', '1234567890')).toBe(false)
  })

  it('accepts 10 digit tax number for company types and rejects 11 digits', () => {
    expect(isValidTaxNumber('limited', '1234567890')).toBe(true)
    expect(isValidTaxNumber('joint_stock', '1234567890')).toBe(true)
    expect(isValidTaxNumber('other', '1234567890')).toBe(true)
    expect(isValidTaxNumber('limited', '12345678901')).toBe(false)
  })

  it('updates tax number field metadata by company type', () => {
    expect(getTaxNumberFieldMeta('individual')).toMatchObject({
      label: 'TC Kimlik No',
      maxLength: 11,
    })
    expect(getTaxNumberFieldMeta('sole_proprietorship')).toMatchObject({
      label: 'TC Kimlik No',
      maxLength: 11,
    })
    expect(getTaxNumberFieldMeta('limited')).toMatchObject({
      label: 'Vergi No',
      maxLength: 10,
    })
  })

  it('normalizes and validates Turkish mobile phone numbers', () => {
    expect(normalizePhone('5551234567')).toBe('05551234567')
    expect(normalizePhone('+90 555 123 45 67')).toBe('05551234567')
    expect(isValidPhone('05551234567')).toBe(true)
    expect(isValidPhone('02121234567')).toBe(false)
  })

  it('blocks contact step when email is not verified or phone is invalid', () => {
    expect(validateContactStep('05551234567', false)).toContain('e-posta')
    expect(validateContactStep('02121234567', true)).toContain('Turkiye cep telefonu')
    expect(validateContactStep('05551234567', true)).toBeNull()
  })

  it('trims tax number input to the expected length', () => {
    expect(normalizeTaxNumber('sole_proprietorship', '1234 5678 9012')).toBe('12345678901')
    expect(normalizeTaxNumber('limited', '12-34-56-78-901')).toBe('1234567890')
  })
})
