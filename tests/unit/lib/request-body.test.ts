import { describe, expect, it } from 'vitest'
import { readJsonBody } from '../../../api/lib/request-body'

function request(body: string | null, init: { signal?: AbortSignal } = {}) {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    body,
    ...(init.signal ? { signal: init.signal } : {}),
  })
}

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    await expect(readJsonBody(request('{"a":1}'))).resolves.toEqual({ a: 1 })
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['truncated', '{"lastSeenMessageId":'],
    ['not json', 'hello'],
  ])('classifies a %s body as INVALID_JSON (400)', async (_name, body) => {
    await expect(readJsonBody(request(body))).rejects.toMatchObject({
      code: 'INVALID_JSON',
      statusCode: 400,
    })
  })

  it('classifies a request aborted by the client as REQUEST_ABORTED (499)', async () => {
    const controller = new AbortController()
    const req = request('', { signal: controller.signal })
    controller.abort()
    await expect(readJsonBody(req)).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
      statusCode: 499,
    })
  })

  it('rethrows other read failures unchanged (500 via handleError)', async () => {
    const failure = new Error('socket read failed')
    const req = {
      text: () => Promise.reject(failure),
      signal: new AbortController().signal,
    } as unknown as Request
    await expect(readJsonBody(req)).rejects.toBe(failure)
  })
})
