export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback

  const value = payload as {
    message?: unknown
    error?: unknown
    errors?: { formErrors?: unknown; fieldErrors?: unknown }
  }

  if (typeof value.message === 'string' && value.message.trim()) return value.message
  if (typeof value.error === 'string' && value.error.trim()) return value.error
  if (
    value.error &&
    typeof value.error === 'object' &&
    'message' in value.error &&
    typeof value.error.message === 'string' &&
    value.error.message.trim()
  ) {
    return value.error.message
  }
  if (Array.isArray(value.errors?.formErrors) && typeof value.errors.formErrors[0] === 'string') {
    return value.errors.formErrors[0]
  }
  if (value.errors?.fieldErrors && typeof value.errors.fieldErrors === 'object') {
    for (const messages of Object.values(value.errors.fieldErrors)) {
      if (Array.isArray(messages) && typeof messages[0] === 'string') return messages[0]
    }
  }

  return fallback
}
