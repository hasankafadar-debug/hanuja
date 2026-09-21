export function buildOrderExportHref(params: {
  q: string
  status: string[]
  invoice: string
  seller: string
  from: string
  to: string
  billing?: string
  sellerApprovalOverdue?: boolean
}) {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status.length > 0) search.set('status', params.status.join(','))
  if (params.invoice) search.set('invoice', params.invoice)
  if (params.seller) search.set('seller', params.seller)
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.billing) search.set('billing', params.billing)
  if (params.sellerApprovalOverdue) search.set('sellerApprovalOverdue', '1')
  search.set('format', 'csv')
  return `/api/admin/orders?${search.toString()}`
}
