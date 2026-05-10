import { describe, expect, it } from 'vitest'
import {
  getSellerStatementDescription,
  getSellerStatementTopic,
} from '../../../api/domain/seller-statement'

describe('seller statement labels', () => {
  it('maps sale entries to seller safe labels', () => {
    expect(getSellerStatementTopic('sale')).toBe('Satış')
    expect(getSellerStatementDescription('sale')).toBe('Brüt satış')
  })

  it('maps payout entries to ödeme/eft', () => {
    expect(getSellerStatementTopic('payout')).toBe('Ödeme')
    expect(getSellerStatementDescription('payout')).toBe('EFT')
  })

  it('maps manual adjustment without exposing internal notes', () => {
    expect(getSellerStatementTopic('manual_adjustment')).toBe('Manuel Düzeltme')
    expect(getSellerStatementDescription('manual_adjustment')).toBe('Manuel düzeltme')
  })
})
