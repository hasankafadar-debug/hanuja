import { describe, expect, it, vi } from 'vitest'
import { createSingleFlight } from '../../apps/web/src/lib/single-flight'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createSingleFlight', () => {
  it('shares one computation across concurrent callers', async () => {
    const gate = deferred<string>()
    const compute = vi.fn(() => gate.promise)
    const load = createSingleFlight(compute)

    const results = Array.from({ length: 20 }, () => load())
    expect(compute).toHaveBeenCalledTimes(1)

    gate.resolve('vitrin')
    await expect(Promise.all(results)).resolves.toEqual(Array(20).fill('vitrin'))
  })

  it('is not a cache: recomputes once the previous flight has settled', async () => {
    const compute = vi.fn(async () => 'x')
    const load = createSingleFlight(compute)

    await load()
    await load()

    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('clears the slot on rejection so the next caller retries', async () => {
    const compute = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce('recovered')
    const load = createSingleFlight(compute)

    const first = load()
    const sameFlight = load()
    await expect(first).rejects.toThrow('db down')
    await expect(sameFlight).rejects.toThrow('db down')

    await expect(load()).resolves.toBe('recovered')
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('treats a synchronous throw inside compute like a rejection', async () => {
    const compute = vi.fn(() => {
      throw new Error('sync boom')
    })
    const load = createSingleFlight(compute as unknown as () => Promise<never>)

    await expect(load()).rejects.toThrow('sync boom')
    await expect(load()).rejects.toThrow('sync boom')
    expect(compute).toHaveBeenCalledTimes(2)
  })
})
