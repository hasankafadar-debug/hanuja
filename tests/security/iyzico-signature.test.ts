import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  computeIyzicoSignature,
  iyzicoAmountsEqual,
  toIyzicoPrice,
  toSignaturePrice,
  verifyCallbackSignature,
  verifyWebhookSignatureV3,
} from '../../api/lib/iyzico'

const secret = 'offline-iyzico-secret'
beforeEach(() => vi.stubEnv('IYZICO_SECRET_KEY', secret))
afterEach(() => vi.unstubAllEnvs())

describe('iyzico yanıt imzası fiyat biçimi (Response Signature Validation)', () => {
  it.each([
    ['10', '10'],
    ['10.0', '10'],
    ['10.50', '10.5'],
    ['10.510', '10.51'],
    ['10.51050', '10.5105'],
  ])('%s → %s', (input, expected) => {
    expect(toSignaturePrice(input)).toBe(expected)
  })

  it('SDK istek biçimiyle aynı string üretir (initialize ile v2 auth eşleşir)', () => {
    expect(toIyzicoPrice('1250.50')).toBe('1250.5')
    expect(toIyzicoPrice('100.00')).toBe('100.0')
    expect(toIyzicoPrice('99.99')).toBe('99.99')
  })

  it('biçim farkını yok sayarak tutarları karşılaştırır', () => {
    expect(iyzicoAmountsEqual('1080.50', '1080.5')).toBe(true)
    expect(iyzicoAmountsEqual('1080.51', '1080.5')).toBe(false)
  })

  it('parçaları ":" ile birleştirip secret key ile HMAC-SHA256 hex üretir', () => {
    const expected = createHmac('sha256', secret).update('p1:TRY:basket:conv:1080.5:1000').digest('hex')
    expect(computeIyzicoSignature(['p1', 'TRY', 'basket', 'conv', '1080.5', '1000'])).toBe(expected)
  })
})

describe('3DS callback imzası', () => {
  const fields = {
    conversationData: null,
    conversationId: 'hnj-1',
    mdStatus: '1',
    paymentId: '22416035',
    status: 'success',
  }

  it('doğru imzayı kabul eder, yanlışını reddeder', () => {
    const signature = createHmac('sha256', secret)
      .update(':hnj-1:1:22416035:success')
      .digest('hex')
    expect(verifyCallbackSignature({ ...fields, signature })).toBe('valid')
    expect(verifyCallbackSignature({ ...fields, mdStatus: '0', signature })).toBe('invalid')
  })

  it('imza alanı yoksa "absent" döner (başarı kanıtı imzalı v2 auth yanıtıdır)', () => {
    expect(verifyCallbackSignature({ ...fields, signature: null })).toBe('absent')
  })
})

describe('X-IYZ-SIGNATURE-V3 webhook imzası', () => {
  const payload = {
    iyziEventType: 'THREE_DS_AUTH',
    paymentId: 22416035,
    paymentConversationId: 'hnj-1',
    status: 'SUCCESS',
  }
  const valid = createHmac('sha256', secret)
    .update(`${secret}THREE_DS_AUTH22416035hnj-1SUCCESS`)
    .digest('hex')

  it('dokümandaki formülle üretilen imzayı kabul eder', () => {
    expect(verifyWebhookSignatureV3(valid, payload)).toBe(true)
    expect(verifyWebhookSignatureV3(valid.toUpperCase(), payload)).toBe(true)
  })

  it.each(['', 'x', 'a'.repeat(64)])('geçersiz imzayı (%j) hata fırlatmadan reddeder', (signature) => {
    expect(verifyWebhookSignatureV3(signature, payload)).toBe(false)
  })

  it('değiştirilmiş alanı reddeder', () => {
    expect(verifyWebhookSignatureV3(valid, { ...payload, status: 'FAILURE' })).toBe(false)
  })

  it('secret yoksa her ortamda reddeder (geliştirme bypass yok)', () => {
    vi.stubEnv('IYZICO_SECRET_KEY', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(verifyWebhookSignatureV3(valid, payload)).toBe(false)
  })
})
