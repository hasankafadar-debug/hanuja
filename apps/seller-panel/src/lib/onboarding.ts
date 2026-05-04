export type CompanyType = 'individual' | 'sole_proprietorship' | 'limited' | 'joint_stock' | 'other'

export interface TaxNumberFieldMeta {
  helperText: string
  label: string
  maxLength: number
  placeholder: string
}

const TURKISH_MOBILE_REGEX = /^05\d{9}$/

export function usesNationalId(companyType: CompanyType): boolean {
  return companyType === 'individual' || companyType === 'sole_proprietorship'
}

export function getTaxNumberFieldMeta(companyType: CompanyType): TaxNumberFieldMeta {
  if (usesNationalId(companyType)) {
    return {
      label: 'TC Kimlik No',
      helperText: '11 haneli TC kimlik numarasi girin.',
      maxLength: 11,
      placeholder: '11 haneli TC kimlik numarasi',
    }
  }

  return {
    label: 'Vergi No',
    helperText: '10 haneli vergi numarasi girin.',
    maxLength: 10,
    placeholder: '10 haneli vergi numarasi',
  }
}

export function normalizeDigits(value: string): string {
  return value.replace(/\D/g, '')
}

export function normalizeTaxNumber(companyType: CompanyType, value: string): string {
  const digits = normalizeDigits(value)
  return digits.slice(0, getTaxNumberFieldMeta(companyType).maxLength)
}

export function isValidTaxNumber(companyType: CompanyType, value: string): boolean {
  return normalizeDigits(value).length === getTaxNumberFieldMeta(companyType).maxLength
}

export function getTaxNumberError(companyType: CompanyType): string {
  return usesNationalId(companyType)
    ? 'TC kimlik numarasi 11 haneli olmalidir.'
    : 'Vergi numarasi 10 haneli olmalidir.'
}

export function normalizePhone(value: string): string {
  const digits = normalizeDigits(value)

  if (digits.length === 10 && digits.startsWith('5')) {
    return `0${digits}`
  }

  if (digits.length === 12 && digits.startsWith('90')) {
    return `0${digits.slice(2)}`
  }

  return digits.slice(0, 11)
}

export function isValidPhone(value: string): boolean {
  return TURKISH_MOBILE_REGEX.test(normalizePhone(value))
}

export function validateContactStep(phone: string, emailVerified: boolean): string | null {
  if (!emailVerified) {
    return 'Basvuru yapmadan once e-posta adresinizi dogrulamaniz gerekir.'
  }

  if (!isValidPhone(phone)) {
    return 'Gecerli bir Turkiye cep telefonu numarasi girin.'
  }

  return null
}

export function validateBusinessStep(input: {
  address: string
  city: string
  companyName: string
  companyType: CompanyType
  district: string
  taxNumber: string
  taxOffice: string
}): string | null {
  if (
    !input.companyName ||
    !input.taxNumber ||
    !input.taxOffice ||
    !input.address ||
    !input.city ||
    !input.district
  ) {
    return 'Lutfen zorunlu alanlari doldurun.'
  }

  if (!isValidTaxNumber(input.companyType, input.taxNumber)) {
    return getTaxNumberError(input.companyType)
  }

  return null
}
