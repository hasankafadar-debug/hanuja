'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

export interface MegaMenuSubItem {
  label: string
  href: string
}

export interface MegaMenuColumn {
  header: string
  href?: string
  items: MegaMenuSubItem[]
}

export interface MegaMenuItem {
  label: string
  href: string
  /** Populated columns trigger the mega-panel; empty array = plain link. */
  columns: MegaMenuColumn[]
}

export interface MegaMenuProps {
  items: MegaMenuItem[]
  className?: string
}

/**
 * Horizontal nav bar + hover-triggered mega-menu panel.
 *
 * Each item with columns shows a full-width panel on mouseEnter.
 * A 150 ms close delay prevents accidental dismissal when moving
 * the cursor toward the panel.
 */
export function MegaMenu({ items, className }: MegaMenuProps) {
  const [activeLabel, setActiveLabel] = React.useState<string | null>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function openPanel(label: string) {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setActiveLabel(label)
  }

  function scheduleClose() {
    closeTimer.current = setTimeout(() => {
      setActiveLabel(null)
    }, 150)
  }

  // Close on ESC
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveLabel(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const activeItem = activeLabel ? items.find((i) => i.label === activeLabel) : null

  return (
    <div className={className} onMouseLeave={scheduleClose}>
      {/* Nav bar */}
      <nav
        aria-label="Kategoriler"
        className="border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6 lg:px-8">
          <ul className="flex items-center gap-0 whitespace-nowrap" role="menubar">
            {items.map((item) => {
              const hasMenu = item.columns.length > 0
              const isOpen = activeLabel === item.label

              return (
                <li key={item.label} role="none">
                  <div
                    className="relative"
                    onMouseEnter={() => {
                      if (hasMenu) openPanel(item.label)
                      else scheduleClose()
                    }}
                  >
                    <Link
                      href={item.href}
                      role="menuitem"
                      aria-haspopup={hasMenu ? 'true' : undefined}
                      aria-expanded={hasMenu ? isOpen : undefined}
                      className="inline-flex items-center gap-1 px-4 py-3 text-sm font-medium transition-colors hover:text-[var(--color-accent)]"
                      style={{
                        color: isOpen ? 'var(--color-accent)' : 'var(--color-primary)',
                      }}
                      onClick={() => {
                        if (isOpen) setActiveLabel(null)
                      }}
                    >
                      {item.label}
                      {hasMenu && (
                        <ChevronDown
                          className="h-3 w-3 transition-transform"
                          style={{
                            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          }}
                          aria-hidden="true"
                        />
                      )}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      {/* Mega-panel */}
      {activeItem && activeItem.columns.length > 0 && (
        <div
          className="absolute left-0 right-0 z-50 border-t-2 shadow-lg"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderTopColor: 'var(--color-accent)',
            borderBottom: '1px solid var(--color-border)',
          }}
          onMouseEnter={() => openPanel(activeItem.label)}
          onMouseLeave={scheduleClose}
          role="region"
          aria-label={`${activeItem.label} alt kategorileri`}
        >
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <div
              className="grid gap-8"
              style={{
                gridTemplateColumns: `repeat(${Math.min(activeItem.columns.length, 4)}, minmax(0, 1fr))`,
              }}
            >
              {activeItem.columns.map((col, colIdx) => (
                <div key={colIdx}>
                  {col.href ? (
                    <Link
                      href={col.href}
                      className="block mb-3 text-xs font-semibold uppercase tracking-widest transition-colors hover:text-[var(--color-accent)]"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {col.header}
                    </Link>
                  ) : (
                    <p
                      className="mb-3 text-xs font-semibold uppercase tracking-widest"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {col.header}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {col.items.map((sub) => (
                      <li key={sub.href}>
                        <Link
                          href={sub.href}
                          className="text-sm transition-colors hover:text-[var(--color-accent)]"
                          style={{ color: 'var(--color-primary)' }}
                          onClick={() => setActiveLabel(null)}
                        >
                          {sub.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
