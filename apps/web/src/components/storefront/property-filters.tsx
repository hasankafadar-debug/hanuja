'use client'
import { useId, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Input, Label } from '@hanuja/ui'
import { parsePropertyFilters, type PropertyFacet } from '@hanuja/api/domain/property-filters'
import { FilterSection } from './filter-section'

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
  const idPrefix = useId()
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
      router.push(`${path}${next.toString() ? `?${next}` : ''}`, {
        scroll: false,
      }),
    )
  }
  return (
    <div aria-label="Özellik Filtreleri">
      {showStock ? (
        <FilterSection title="Ürün Durumu">
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              disabled={pending}
              checked={['1', 'true'].includes(params.get('stokta') ?? '')}
              onChange={(e) => update({ stokta: e.target.checked ? '1' : null })}
            />
            Yalnız stokta olanlar
          </label>
        </FilterSection>
      ) : null}
      {facets.map((facet) => (
        <FilterSection
          key={facet.key}
          title={`${facet.label}${facet.kind === 'range' && facet.unit && facet.unit !== '—' ? ` (${facet.unit})` : ''}`}
        >
          <fieldset disabled={pending} aria-label={facet.label}>
            {facet.kind === 'range' ? (
              <form
                key={params.toString()}
                onSubmit={(e) => {
                  e.preventDefault()
                  const data = new FormData(e.currentTarget)
                  update({
                    [`r.${facet.key}.min`]: String(data.get('min') ?? ''),
                    [`r.${facet.key}.max`]: String(data.get('max') ?? ''),
                    [`f.${facet.key}`]: null,
                  })
                }}
                className="space-y-2"
              >
                <div className="flex gap-2">
                  <Input
                    name="min"
                    type="number"
                    step="any"
                    aria-label={`${facet.label} en az`}
                    placeholder={facet.min !== undefined ? String(facet.min) : 'En az'}
                    defaultValue={filters[facet.key]?.min ?? ''}
                  />
                  <Input
                    name="max"
                    type="number"
                    step="any"
                    aria-label={`${facet.label} en çok`}
                    placeholder={facet.max !== undefined ? String(facet.max) : 'En çok'}
                    defaultValue={filters[facet.key]?.max ?? ''}
                  />
                </div>
                <Button type="submit" size="sm" variant="outline">
                  Uygula
                </Button>
                <Button
                  type="reset"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    update({
                      [`r.${facet.key}.min`]: null,
                      [`r.${facet.key}.max`]: null,
                    })
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
                    const id = `${idPrefix}-${facet.key}-${encodeURIComponent(value.value)}`
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
                            update({
                              [`f.${facet.key}`]: next.length ? JSON.stringify(next) : null,
                            })
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
        </FilterSection>
      ))}
    </div>
  )
}
