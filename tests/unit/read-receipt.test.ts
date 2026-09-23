import { describe, expect, it, vi } from 'vitest'
import { startReadReceipt } from '../../packages/ui/src/lib/read-receipt'

function json(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

/** Manual scheduler + visibility so every retry is observable and deterministic. */
function harness(responses: Array<Response | Error>, options: { visible?: boolean } = {}) {
  const timers: Array<{ callback: () => void; delayMs: number; cancelled: boolean }> = []
  let visible = options.visible ?? true
  const listeners = new Set<() => void>()
  const send = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected extra send')
    if (next instanceof Error) throw next
    return next
  })
  const onAdvanced = vi.fn()
  const receipt = startReadReceipt({
    send,
    onAdvanced,
    isVisible: () => visible,
    onVisibilityChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    schedule: (callback, delayMs) => {
      const timer = { callback, delayMs, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    receipt,
    send,
    onAdvanced,
    timers,
    listeners,
    flush,
    async fireNextTimer() {
      const timer = timers.find((t) => !t.cancelled && !('fired' in t))
      if (!timer) throw new Error('no pending timer')
      Object.assign(timer, { fired: true })
      timer.callback()
      await flush()
    },
    async setVisible(value: boolean) {
      visible = value
      for (const listener of [...listeners]) listener()
      await flush()
    },
  }
}

describe('startReadReceipt', () => {
  it('sends once on success and never again', async () => {
    const h = harness([json(200, { data: { advanced: true } })])
    await h.flush()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.onAdvanced).toHaveBeenCalledTimes(1)
    expect(h.receipt.outcome()).toBe('sent')
    await h.setVisible(false)
    await h.setVisible(true)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.timers).toHaveLength(0)
    expect(h.listeners.size).toBe(0)
  })

  it('does not refresh when the boundary did not move', async () => {
    const h = harness([json(200, { data: { advanced: false } })])
    await h.flush()
    expect(h.onAdvanced).not.toHaveBeenCalled()
    expect(h.receipt.outcome()).toBe('sent')
  })

  it('retries a 500 with a growing delay and stops on success', async () => {
    const h = harness([json(500), json(503), json(200, { data: { advanced: true } })])
    await h.flush()
    expect(h.timers.map((t) => t.delayMs)).toEqual([1000])
    await h.fireNextTimer()
    expect(h.timers.map((t) => t.delayMs)).toEqual([1000, 3000])
    await h.fireNextTimer()
    expect(h.send).toHaveBeenCalledTimes(3)
    expect(h.receipt.outcome()).toBe('sent')
    expect(h.onAdvanced).toHaveBeenCalledTimes(1)
  })

  it('honours Retry-After on 429, capped', async () => {
    const h = harness([json(429, {}, { 'Retry-After': '7' }), json(429, {}, { 'Retry-After': '999' })])
    await h.flush()
    expect(h.timers[0]!.delayMs).toBe(7000)
    await h.fireNextTimer()
    expect(h.timers[1]!.delayMs).toBe(30_000)
  })

  it('retries network errors but gives up after the attempt limit', async () => {
    const h = harness([new TypeError('Failed to fetch'), json(502), json(500)])
    await h.flush()
    await h.fireNextTimer()
    await h.fireNextTimer()
    expect(h.send).toHaveBeenCalledTimes(3)
    expect(h.receipt.outcome()).toBe('gave_up')
    expect(h.timers.filter((t) => !t.cancelled && !('fired' in t))).toHaveLength(0)
  })

  it.each([400, 401, 403, 404, 422])('does not retry a %s', async (status) => {
    const h = harness([json(status)])
    await h.flush()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.timers).toHaveLength(0)
    expect(h.receipt.outcome()).toBe('rejected')
  })

  it('waits while hidden and sends when the page becomes visible', async () => {
    const h = harness([json(200, { data: { advanced: true } })], { visible: false })
    await h.flush()
    expect(h.send).not.toHaveBeenCalled()
    await h.setVisible(true)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('a retry that comes due while hidden waits for visibility', async () => {
    const h = harness([json(500), json(200, { data: { advanced: true } })])
    await h.flush()
    await h.setVisible(false)
    await h.fireNextTimer()
    expect(h.send).toHaveBeenCalledTimes(1)
    await h.setVisible(true)
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.receipt.outcome()).toBe('sent')
  })

  it('cancel stops a pending retry', async () => {
    const h = harness([json(500)])
    await h.flush()
    h.receipt.cancel()
    expect(h.timers[0]!.cancelled).toBe(true)
    expect(h.receipt.outcome()).toBe('cancelled')
  })
})
