import type { RawAdminSearchParams } from './admin-list-params'

export type RefundTab = 'requests' | 'manual_refunds' | 'failed_card_refunds'
export type RefundQueueParams = {
  tab: Exclude<RefundTab, 'requests'>
  q: string
  method: 'all' | 'eft' | 'card' | 'missing'
  source: 'all' | 'cancellation' | 'return_request' | 'dispute'
  page: number
  pageSize: number
}

function single(raw: RawAdminSearchParams | undefined, key: string) {
  const value = raw?.[key]
  return Array.isArray(value) ? value[0] : value
}

export function readRefundTab(raw?: RawAdminSearchParams): RefundTab {
  const tab = single(raw, 'tab')
  return tab === 'manual_refunds' || tab === 'failed_card_refunds' ? tab : 'requests'
}

export function parseRefundQueueParams(
  raw: RawAdminSearchParams | undefined,
  tab: RefundQueueParams['tab'],
): RefundQueueParams {
  const method = single(raw, 'method')
  const source = single(raw, 'source')
  const page = Number(single(raw, 'page'))
  const pageSize = Number(single(raw, 'pageSize'))
  return {
    tab,
    q: (single(raw, 'q') ?? '').trim().slice(0, 100),
    method:
      tab === 'manual_refunds' && (method === 'eft' || method === 'card' || method === 'missing')
        ? method
        : 'all',
    source:
      source === 'cancellation' || source === 'return_request' || source === 'dispute'
        ? source
        : 'all',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 9999) : 1,
    pageSize: [20, 50, 100].includes(pageSize) ? pageSize : 20,
  }
}

export function refundQueueHref(params: RefundQueueParams, page = params.page) {
  const query = new URLSearchParams({ tab: params.tab })
  if (params.q) query.set('q', params.q)
  if (params.method !== 'all') query.set('method', params.method)
  if (params.source !== 'all') query.set('source', params.source)
  if (params.pageSize !== 20) query.set('pageSize', String(params.pageSize))
  if (page > 1) query.set('page', String(page))
  return `/iadeler?${query.toString()}`
}
