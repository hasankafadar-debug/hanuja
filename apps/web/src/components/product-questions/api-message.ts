/** Human message from our API error shapes (domain error, rate limit, validation). */
export function productQuestionApiMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }
  return fallback
}

export const PRODUCT_QUESTION_MAX_LENGTH = 2000
