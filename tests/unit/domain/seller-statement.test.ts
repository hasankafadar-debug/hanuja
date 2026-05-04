import { describe, expect, it } from 'vitest'
import {
  getSellerStatementDescription,
  getSellerStatementTopic,
} from '../../../api/domain/seller-statement'

describe('seller statement labels', () => {
  it('maps sale entries to seller safe labels', () => {
    expect(getSellerStatementTopic('sale')).toBe('Satis')
    expect(getSellerStatementDescription('sale')).toBe('Brut satis')
  })

  it('maps payout entries to odeme/eft', () => {
    expect(getSellerStatementTopic('payout')).toBe('Odeme')
    expect(getSellerStatementDescription('payout')).toBe('EFT')
  })

  it('maps manual adjustment without exposing internal notes', () => {
    expect(getSellerStatementTopic('manual_adjustment')).toBe('Manuel Duzeltme')
    expect(getSellerStatementDescription('manual_adjustment')).toBe('Manuel duzeltme')
  })
})
