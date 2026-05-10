import { describe, expect, it } from 'vitest'
import {
  buildSellerStatementExportRows,
  SELLER_STATEMENT_EXPORT_HEADERS,
} from '../../../api/domain/seller-statement-export'

describe('seller statement export rows', () => {
  it('exposes the official statement headers in order', () => {
    expect(SELLER_STATEMENT_EXPORT_HEADERS).toEqual([
      'Tarih',
      'Referans',
      'Konu',
      'Açıklama',
      'Alacak',
      'Borç',
      'Bakiye',
    ])
  })

  it('prepends the opening balance row using the selected from date', () => {
    const rows = buildSellerStatementExportRows({
      from: new Date('2026-05-01T00:00:00.000Z'),
      openingBalance: 1250.5,
      rows: [],
    })

    expect(rows[0]).toEqual({
      Tarih: '01.05.2026',
      Referans: '-',
      Konu: 'Devir',
      Açıklama: 'Dönem başı bakiyesi',
      Alacak: '1.250,50',
      Borç: '',
      Bakiye: '1.250,50',
    })
  })

  it('formats debit, credit, and running balance columns for movement rows', () => {
    const rows = buildSellerStatementExportRows({
      from: new Date('2026-05-01T00:00:00.000Z'),
      openingBalance: 0,
      rows: [
        {
          id: 'row-credit',
          date: new Date('2026-05-02T00:00:00.000Z'),
          reference: '#ABCD1234',
          topic: 'Satış',
          description: 'Brüt satış',
          credit: 500,
          debit: 0,
          balance: 500,
        },
        {
          id: 'row-debit',
          date: new Date('2026-05-03T00:00:00.000Z'),
          reference: '#EFGH5678',
          topic: 'Komisyon',
          description: 'Platform komisyonu',
          credit: 0,
          debit: 75.25,
          balance: 424.75,
        },
      ],
    })

    expect(rows[1]).toEqual({
      Tarih: '02.05.2026',
      Referans: '#ABCD1234',
      Konu: 'Satış',
      Açıklama: 'Brüt satış',
      Alacak: '500,00',
      Borç: '',
      Bakiye: '500,00',
    })
    expect(rows[2]).toEqual({
      Tarih: '03.05.2026',
      Referans: '#EFGH5678',
      Konu: 'Komisyon',
      Açıklama: 'Platform komisyonu',
      Alacak: '',
      Borç: '75,25',
      Bakiye: '424,75',
    })
  })
})
