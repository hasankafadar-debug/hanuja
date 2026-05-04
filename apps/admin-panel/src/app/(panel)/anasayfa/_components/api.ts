export async function readApiData<T>(response: Response): Promise<T> {
  const text = await response.text()
  const json = text ? (JSON.parse(text) as { data?: T; message?: string } | T) : null

  if (!response.ok) {
    const message =
      json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
        ? json.message
        : 'İşlem tamamlanamadı.'
    throw new Error(message)
  }

  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T
  }

  return json as T
}

export function toDatetimeLocal(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function emptyToNull(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
