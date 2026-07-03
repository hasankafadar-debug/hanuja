import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Hex renk validasyonu — CSS injection'a karşı koruma
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Geçerli bir renk kodu girin')

const safeUrl = z.string().url().max(500).startsWith('https://', 'Yalnızca HTTPS URL kabul edilir')

const profileBrandSchema = z.object({
  bannerColor: hexColor.optional(),
  bannerTextColor: hexColor.optional(),
  bannerHeadline: z.string().max(60).optional(),
  bannerHeadlineFontSize: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
  logoUrl: safeUrl.optional(),
  bannerUrl: safeUrl.optional(),
})

describe('bannerColor — hex validation (CSS injection koruması)', () => {
  it('6 haneli büyük harf hex kabul eder', () => {
    expect(hexColor.safeParse('#FF0000').success).toBe(true)
    expect(hexColor.safeParse('#FFFFFF').success).toBe(true)
    expect(hexColor.safeParse('#1A2B3C').success).toBe(true)
  })

  it('6 haneli küçük harf hex kabul eder', () => {
    expect(hexColor.safeParse('#ff0000').success).toBe(true)
    expect(hexColor.safeParse('#aabbcc').success).toBe(true)
  })

  it('CSS renk adlarını reddeder', () => {
    expect(hexColor.safeParse('red').success).toBe(false)
    expect(hexColor.safeParse('white').success).toBe(false)
    expect(hexColor.safeParse('transparent').success).toBe(false)
  })

  it('8 haneli (alpha) hex reddeder', () => {
    expect(hexColor.safeParse('#FF000000').success).toBe(false)
  })

  it('3 haneli kısa hex reddeder', () => {
    expect(hexColor.safeParse('#F00').success).toBe(false)
  })

  it('CSS injection girişimini reddeder', () => {
    expect(hexColor.safeParse('red; background:url(x)').success).toBe(false)
    expect(hexColor.safeParse('#fff; color:red').success).toBe(false)
    expect(hexColor.safeParse('expression(alert(1))').success).toBe(false)
  })

  it('# prefix olmayan hex reddeder', () => {
    expect(hexColor.safeParse('FF0000').success).toBe(false)
  })

  it('boş string reddeder', () => {
    expect(hexColor.safeParse('').success).toBe(false)
  })
})

describe('bannerHeadline — uzunluk kısıtı', () => {
  it('60 karaktere kadar kabul eder', () => {
    const result = profileBrandSchema.safeParse({ bannerHeadline: 'A'.repeat(60) })
    expect(result.success).toBe(true)
  })

  it('61 karakter reddeder', () => {
    const result = profileBrandSchema.safeParse({ bannerHeadline: 'A'.repeat(61) })
    expect(result.success).toBe(false)
  })
})

describe('bannerHeadlineFontSize — enum kısıtı', () => {
  it('geçerli değerleri kabul eder', () => {
    for (const v of ['sm', 'md', 'lg', 'xl']) {
      expect(profileBrandSchema.safeParse({ bannerHeadlineFontSize: v }).success).toBe(true)
    }
  })

  it('geçersiz değerleri reddeder', () => {
    expect(profileBrandSchema.safeParse({ bannerHeadlineFontSize: 'xxl' }).success).toBe(false)
    expect(profileBrandSchema.safeParse({ bannerHeadlineFontSize: '16px' }).success).toBe(false)
    expect(profileBrandSchema.safeParse({ bannerHeadlineFontSize: 'huge' }).success).toBe(false)
  })
})

describe('logoUrl / bannerUrl — URL kısıtı', () => {
  it('geçerli HTTPS URL kabul eder', () => {
    const result = profileBrandSchema.safeParse({
      logoUrl: 'https://cdn.example.com/stores/logo.jpg',
    })
    expect(result.success).toBe(true)
  })

  it('biçimsiz URL reddeder', () => {
    expect(profileBrandSchema.safeParse({ logoUrl: 'not-a-url' }).success).toBe(false)
  })

  it('javascript: protokolü reddeder (XSS koruması)', () => {
    // javascript: teknik olarak geçerli URL sayılır; startsWith('https://') ile engellenir
    expect(profileBrandSchema.safeParse({ bannerUrl: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('HTTP (non-HTTPS) URL reddeder', () => {
    expect(profileBrandSchema.safeParse({ logoUrl: 'http://cdn.example.com/logo.jpg' }).success).toBe(false)
  })
})
