'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <div className="mb-5">
      <button
        id={`${id}-heading`}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 py-1 text-left"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      <div
        id={`${id}-content`}
        role="region"
        aria-labelledby={`${id}-heading`}
        hidden={!open}
        className="mt-2"
      >
        {children}
      </div>
    </div>
  )
}
