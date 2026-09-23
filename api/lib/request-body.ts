import { InvalidJsonBodyError, RequestAbortedError } from './errors'

/**
 * Reads a JSON request body and classifies failures:
 *   - client disconnected before/while sending the body → RequestAbortedError (499)
 *   - empty body or malformed JSON                      → InvalidJsonBodyError (400)
 *   - any other read failure                            → rethrown (500 via handleError)
 * Only body reading is classified here; errors from services and the database
 * after parsing keep their own status.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  let text: string
  try {
    text = await req.text()
  } catch (error) {
    if (req.signal?.aborted) throw new RequestAbortedError()
    throw error
  }
  if (req.signal?.aborted) throw new RequestAbortedError()
  if (text.trim() === '') throw new InvalidJsonBodyError()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new InvalidJsonBodyError()
  }
}
