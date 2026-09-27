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

// Literal class names so Tailwind generates them; one column on phones.
const PANEL_GRID_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
}

/**
 * Horizontal nav bar + mega-menu panel.
 *
 * Mouse: the panel opens on hover, with a 150 ms close delay so the cursor can
 * travel to it, and a click on the item opens the category page.
 * Touch: a tap on an item with sub-categories toggles the panel instead of
 * navigating (the panel links to the whole category); a tap outside closes it.
 * Keyboard: Enter opens the category page.
 *
 * Render it outside any overflow container — the panel is absolutely positioned
 * below the strip and `overflow: auto` on an ancestor would clip it.
 */
export function MegaMenu({ items, className }: MegaMenuProps) {
  const [activeLabel, setActiveLabel] = React.useState<string | null>(null)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  // Pointer type of the latest press, so a touch tap can open the panel instead of navigating.
  const lastPointerType = React.useRef('')

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function openPanel(label: string) {
    clearCloseTimer()
    setActiveLabel(label)
  }

  function closePanel() {
    clearCloseTimer()
    setActiveLabel(null)
  }

  function scheduleClose() {
    clearCloseTimer()
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

  // Touch has no mouseleave: a press anywhere outside the menu closes the panel.
  React.useEffect(() => {
    if (!activeLabel) return
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setActiveLabel(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [activeLabel])

  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    },
    [],
  )

  const activeItem = activeLabel ? items.find((i) => i.label === activeLabel) : null

  return (
    <div
      ref={rootRef}
      className={className}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') scheduleClose()
      }}
    >
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
                    onPointerEnter={(e) => {
                      if (e.pointerType !== 'mouse') return
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
                      onPointerDown={(e) => {
                        lastPointerType.current = e.pointerType
                      }}
                      onClick={(e) => {
                        const isTouch =
                          lastPointerType.current === 'touch' || lastPointerType.current === 'pen'
                        lastPointerType.current = ''
                        if (hasMenu && isTouch) {
                          e.preventDefault()
                          if (isOpen) closePanel()
                          else openPanel(item.label)
                          return
                        }
                        closePanel()
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
          className="absolute left-0 right-0 z-50 max-h-[70vh] overflow-y-auto border-t-2 shadow-lg"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderTopColor: 'var(--color-accent)',
            borderBottom: '1px solid var(--color-border)',
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') openPanel(activeItem.label)
          }}
          role="region"
          aria-label={`${activeItem.label} alt kategorileri`}
        >
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
            <Link
              href={activeItem.href}
              className="mb-4 inline-block text-sm font-medium underline underline-offset-4 transition-colors hover:text-[var(--color-accent)] sm:mb-6"
              style={{ color: 'var(--color-primary)' }}
              onClick={closePanel}
            >
              Tüm {activeItem.label} ürünleri →
            </Link>
            <div
              className={`grid gap-6 sm:gap-8 ${PANEL_GRID_COLUMNS[Math.min(activeItem.columns.length, 4)]}`}
            >
              {activeItem.columns.map((col, colIdx) => (
                <div key={colIdx}>
                  {col.href ? (
                    <Link
                      href={col.href}
                      className="block mb-3 text-xs font-semibold uppercase tracking-widest transition-colors hover:text-[var(--color-accent)]"
                      style={{ color: 'var(--color-muted-fg)' }}
                      onClick={closePanel}
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
                          onClick={closePanel}
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
