'use client'
import { useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Label } from '@hanuja/ui'
import { parsePropertyFilters, type PropertyFacet } from '@hanuja/api/domain/property-filters'

export default function PropertyFilters({
  facets,
  pageParam = 'sayfa',
  showStock = false,
}: {
  facets: PropertyFacet[]
  pageParam?: string
  showStock?: boolean
}) {
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams(),
    [pending, startTransition] = useTransition()
  const filters = parsePropertyFilters(new URLSearchParams(params.toString()))
  const [ranges, setRanges] = useState<Record<string, { min: string; max: string }>>({})
  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    next.delete(pageParam)
    next.delete('sayfa')
    next.delete('page')
    startTransition(() =>
      router.push(`${path}${next.toString() ? `?${next}` : ''}`, { scroll: false }),
    )
  }
  return (
    <div className="space-y-5" aria-label="Özellik Filtreleri">
      {showStock ? (
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            disabled={pending}
            checked={params.get('stock') === '1'}
            onChange={(e) => update({ stock: e.target.checked ? '1' : null })}
          />
          Yalnız stokta olanlar
        </label>
      ) : null}
      {facets.map((facet) => (
        <fieldset
          key={facet.key}
          className="space-y-2 border-t pt-4"
          style={{ borderColor: 'var(--color-border)' }}
          disabled={pending}
        >
          <legend className="pt-3 text-sm font-semibold">
            {facet.label}
            {facet.kind === 'range' && facet.unit && facet.unit !== '—' ? ` (${facet.unit})` : ''}
          </legend>
          {facet.kind === 'range' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const range = ranges[facet.key] ?? {
                  min: filters[facet.key]?.min !== undefined ? String(filters[facet.key]?.min) : '',
                  max: filters[facet.key]?.max !== undefined ? String(filters[facet.key]?.max) : '',
                }
                update({
                  [`r.${facet.key}.min`]: range.min,
                  [`r.${facet.key}.max`]: range.max,
                  [`f.${facet.key}`]: null,
                })
              }}
              className="space-y-2"
            >
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="any"
                  aria-label={`${facet.label} en az`}
                  placeholder={facet.min !== undefined ? String(facet.min) : 'En az'}
                  value={
                    ranges[facet.key]?.min ??
                    (filters[facet.key]?.min !== undefined ? String(filters[facet.key]?.min) : '')
                  }
                  onChange={(e) =>
                    setRanges({
                      ...ranges,
                      [facet.key]: {
                        min: e.target.value,
                        max:
                          ranges[facet.key]?.max ??
                          (filters[facet.key]?.max !== undefined
                            ? String(filters[facet.key]?.max)
                            : ''),
                      },
                    })
                  }
                />
                <Input
                  type="number"
                  step="any"
                  aria-label={`${facet.label} en çok`}
                  placeholder={facet.max !== undefined ? String(facet.max) : 'En çok'}
                  value={
                    ranges[facet.key]?.max ??
                    (filters[facet.key]?.max !== undefined ? String(filters[facet.key]?.max) : '')
                  }
                  onChange={(e) =>
                    setRanges({
                      ...ranges,
                      [facet.key]: {
                        max: e.target.value,
                        min:
                          ranges[facet.key]?.min ??
                          (filters[facet.key]?.min !== undefined
                            ? String(filters[facet.key]?.min)
                            : ''),
                      },
                    })
                  }
                />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Uygula
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRanges({ ...ranges, [facet.key]: { min: '', max: '' } })
                  update({ [`r.${facet.key}.min`]: null, [`r.${facet.key}.max`]: null })
                }}
              >
                Temizle
              </Button>
            </form>
          ) : (
            <div className="max-h-52 space-y-2 overflow-auto">
              {facet.values
                .filter(
                  (v) => !['buyuk_beden', 'tesettur'].includes(facet.key) || v.value === 'true',
                )
                .map((value) => {
                  const selected = (filters[facet.key]?.values ?? []).map(String)
                  const id = `filter-${facet.key}-${encodeURIComponent(value.value)}`
                  return (
                    <div key={value.value} className="flex items-start gap-2">
                      <input
                        id={id}
                        type="checkbox"
                        checked={selected.includes(value.value)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selected, value.value]
                            : selected.filter((v) => v !== value.value)
                          update({ [`f.${facet.key}`]: next.length ? JSON.stringify(next) : null })
                        }}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor={id}
                        className="flex flex-1 justify-between gap-2 text-sm font-normal"
                      >
                        <span>
                          {['buyuk_beden', 'tesettur'].includes(facet.key)
                            ? facet.label
                            : value.label}
                        </span>
                        <span style={{ color: 'var(--color-muted-fg)' }}>{value.count}</span>
                      </Label>
                    </div>
                  )
                })}
            </div>
          )}
        </fieldset>
      ))}
    </div>
  )
}
