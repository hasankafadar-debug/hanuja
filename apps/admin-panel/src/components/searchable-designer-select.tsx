'use client'

import { useId, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@hanuja/ui'

interface Designer {
  id: string
  name: string
}

interface SearchableDesignerSelectProps {
  id: string
  sellers: Designer[]
  value: string
  onChange: (value: string) => void
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
}

export function SearchableDesignerSelect({ id, sellers, value, onChange }: SearchableDesignerSelectProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const selected = sellers.find((seller) => seller.id === value)
  const matches = useMemo(() => {
    const query = normalizeSearch(search.trim())
    return sellers.filter((seller) => normalizeSearch(seller.name).includes(query))
  }, [sellers, search])
  const visible = matches.slice(0, 50)

  function close() {
    setOpen(false)
    setSearch('')
    setActiveIndex(-1)
  }

  function select(seller: Designer) {
    onChange(seller.id)
    close()
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 && activeIndex < visible.length ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder={open ? 'Tasarımcı ara...' : 'Tasarımcı seçin'}
        value={open ? search : selected?.name ?? ''}
        onFocus={() => { setOpen(true); setSearch(''); setActiveIndex(-1) }}
        onClick={() => { if (!open) { setOpen(true); setSearch(''); setActiveIndex(-1) } }}
        onBlur={close}
        onChange={(event) => {
          onChange('')
          setSearch(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            close()
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              setOpen(true)
              setSearch('')
              setActiveIndex(event.key === 'ArrowDown' ? 0 : Math.min(matches.length, 50) - 1)
            } else if (visible.length) {
              setActiveIndex((current) => current < 0
                ? event.key === 'ArrowDown' ? 0 : visible.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length)
            }
          } else if (event.key === 'Enter' && open && visible.length) {
            event.preventDefault()
            select(visible[activeIndex >= 0 && activeIndex < visible.length ? activeIndex : 0]!)
          }
        }}
      />
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-3 h-4 w-4 opacity-60" />
      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-[var(--color-surface)] p-1 shadow-lg" style={{ borderColor: 'var(--color-border)' }}>
          <div id={listId} role="listbox" aria-label="Tasarımcılar" className="max-h-48 overflow-y-auto">
            {visible.map((seller, index) => (
              <button
                id={`${listId}-${index}`}
                key={seller.id}
                type="button"
                role="option"
                aria-selected={seller.id === value}
                tabIndex={-1}
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--color-muted)]"
                style={{ backgroundColor: activeIndex === index ? 'var(--color-muted)' : undefined }}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(seller)}
              >
                {seller.name}
              </button>
            ))}
          </div>
          {visible.length === 0 ? <p className="px-3 py-2 text-sm" role="status">Tasarımcı bulunamadı.</p> : null}
          {matches.length > visible.length ? <p className="px-3 py-2 text-xs">Diğer sonuçlar için aramayı daraltın.</p> : null}
        </div>
      ) : null}
    </div>
  )
}
