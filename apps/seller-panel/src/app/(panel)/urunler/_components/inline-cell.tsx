'use client'

import { useEffect, useState } from 'react'

interface InlineCellProps {
  value: number
  disabled?: boolean
  min?: number
  step?: number
  onSubmit: (value: number) => Promise<void>
}

export default function InlineCell({
  value,
  disabled = false,
  min = 0,
  step = 1,
  onSubmit,
}: InlineCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) {
      setDraft(String(value))
    }
  }, [editing, value])

  async function commit() {
    const nextValue = Number(draft)
    if (!Number.isFinite(nextValue) || nextValue < min || nextValue === value) {
      setEditing(false)
      setDraft(String(value))
      return
    }

    setSaving(true)
    try {
      await onSubmit(nextValue)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="rounded px-2 py-1 text-left transition-colors hover:bg-[var(--color-muted)]"
        style={{ color: 'inherit' }}
      >
        {value}
      </button>
    )
  }

  return (
    <input
      autoFocus
      type="number"
      min={min}
      step={step}
      value={draft}
      disabled={saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void commit()
        }
        if (event.key === 'Escape') {
          setEditing(false)
          setDraft(String(value))
        }
      }}
      className="h-9 w-24 rounded-lg border px-2 text-sm outline-none"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-primary)',
      }}
    />
  )
}
