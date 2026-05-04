export function formatOrderNumber(value: number | string | null | undefined, fallbackId?: string | null) {
  if (value !== null && value !== undefined && String(value).trim()) {
    return String(value)
  }

  if (fallbackId) {
    return fallbackId.slice(-8).toUpperCase()
  }

  return ''
}

export function formatOrderDisplayNumber(
  value: number | string | null | undefined,
  fallbackId?: string | null,
) {
  const orderNumber = formatOrderNumber(value, fallbackId)
  return orderNumber ? `#${orderNumber}` : '#'
}
