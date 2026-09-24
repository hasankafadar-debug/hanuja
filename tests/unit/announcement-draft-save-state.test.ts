/**
 * Announcement draft saves: an edit made while a save is in flight must stay
 * unsaved (otherwise the editor shows new text while the send would use the old
 * one), and saves run one at a time, each sending the version the previous one
 * returned.
 */
import { describe, expect, it, vi } from 'vitest'
import { createDraftSaveState } from '../../apps/admin-panel/src/app/(panel)/duyurular/_components/draft-save-state'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('announcement draft save state', () => {
  it('starts clean at the loaded version', () => {
    expect(createDraftSaveState(3).snapshot()).toEqual({ version: 3, dirty: false })
  })

  it('keeps an edit made during a delayed save unsaved', async () => {
    const state = createDraftSaveState(3)
    state.markEdited() // "Kargo kuralı"
    const response = deferred<number | null>()
    const sent: string[] = []
    let field = 'Kargo kuralı'
    const saving = state.save(async (version) => {
      sent.push(`${version}:${field}`)
      return response.promise
    })
    await tick()

    // The admin keeps typing while the request is in flight.
    field = 'Kargo kuralı değişti'
    state.markEdited()
    response.resolve(4)
    await expect(saving).resolves.toBe(4)

    // The response only covered the first text: the draft is still dirty.
    expect(state.snapshot()).toEqual({ version: 4, dirty: true })
    expect(sent).toEqual(['3:Kargo kuralı'])

    // The next save carries the new text with the returned version and is clean.
    await expect(
      state.save(async (version) => {
        sent.push(`${version}:${field}`)
        return 5
      }),
    ).resolves.toBe(5)
    expect(sent).toEqual(['3:Kargo kuralı', '4:Kargo kuralı değişti'])
    expect(state.snapshot()).toEqual({ version: 5, dirty: false })
  })

  it('runs overlapping saves one after another with the returned version', async () => {
    const state = createDraftSaveState(1)
    state.markEdited()
    const first = deferred<number | null>()
    const secondSend = vi.fn(async (version: number) => version + 1)

    const a = state.save(() => first.promise)
    state.markEdited()
    const b = state.save(secondSend)
    await tick()
    expect(secondSend).not.toHaveBeenCalled()

    first.resolve(2)
    await expect(a).resolves.toBe(2)
    await expect(b).resolves.toBe(3)
    expect(secondSend).toHaveBeenCalledWith(2)
    expect(state.snapshot()).toEqual({ version: 3, dirty: false })
  })

  it('leaves the draft dirty and the version unchanged when a save is refused or fails', async () => {
    const state = createDraftSaveState(7)
    state.markEdited()
    await expect(state.save(async () => null)).resolves.toBeNull()
    expect(state.snapshot()).toEqual({ version: 7, dirty: true })

    await expect(
      state.save(async () => {
        throw new Error('network')
      }),
    ).rejects.toThrow('network')
    expect(state.snapshot()).toEqual({ version: 7, dirty: true })

    // A failure does not block the queue.
    await expect(state.save(async (version) => version + 1)).resolves.toBe(8)
    expect(state.snapshot()).toEqual({ version: 8, dirty: false })
  })
})
