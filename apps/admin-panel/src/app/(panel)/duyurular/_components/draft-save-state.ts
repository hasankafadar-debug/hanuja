/**
 * Save bookkeeping for the announcement draft editor. Framework-free so the
 * ordering rules are unit-testable.
 *
 * Fields stay editable while a save is in flight, so a response must never mark
 * edits made after the request left as saved: every edit bumps `editSeq`, and a
 * successful save only clears the edits it actually carried. Saves run one at a
 * time, each sending the version the previous one returned, so two quick saves
 * never race each other into a version conflict.
 */

export interface DraftSaveSnapshot {
  /** Version of the last successful save (the one the server will accept next). */
  version: number
  /** True while any edit is not contained in a successful save. */
  dirty: boolean
}

/**
 * `send` receives the version to send and must read the field values at call time
 * (not from the closure that queued it). It resolves to the new version, or null
 * when the save was refused.
 */
export type DraftSaveSend = (version: number) => Promise<number | null>

export function createDraftSaveState(initialVersion: number) {
  let version = initialVersion
  let editSeq = 0
  let savedSeq = 0
  let chain: Promise<unknown> = Promise.resolve()

  return {
    markEdited() {
      editSeq += 1
    },

    snapshot(): DraftSaveSnapshot {
      return { version, dirty: editSeq !== savedSeq }
    },

    save(send: DraftSaveSend): Promise<number | null> {
      const run = chain.then(async () => {
        // Captured when this save actually starts: later edits stay dirty.
        const carriedSeq = editSeq
        const next = await send(version)
        if (next === null) return null
        version = next
        savedSeq = Math.max(savedSeq, carriedSeq)
        return next
      })
      chain = run.catch(() => undefined)
      return run
    },
  }
}

export type DraftSaveState = ReturnType<typeof createDraftSaveState>
