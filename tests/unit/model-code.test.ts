import { describe, expect, it } from 'vitest'
import { normalizeModelCode, requireModelCode } from '../../api/domain/model-code'

describe('model code normalization', () => {
  it('uses NFKC, trims, collapses spaces, and uppercases the stored value', () => {
    expect(normalizeModelCode('  model\u00a0  01  ')).toBe('MODEL 01')
  })

  it('rejects an empty model code', () => {
    expect(() => requireModelCode('   ')).toThrow('Model Kodu zorunludur')
  })
})
