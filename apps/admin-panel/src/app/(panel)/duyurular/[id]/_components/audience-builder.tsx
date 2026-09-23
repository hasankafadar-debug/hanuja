'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AnnouncementAudience } from '@hanuja/api/domain/announcement-audience'
import { ANNOUNCEMENT_ELIGIBLE_STATUSES } from '@hanuja/api/domain/announcement-audience'
import { Button, Checkbox, Input, Label } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import type { FilterOptionsData, ManualSellerRef, SellerSearchResult } from '../../_components/types'

interface AudienceBuilderProps {
  audience: AnnouncementAudience
  manualSellers: Record<string, ManualSellerRef>
  filterOptions: FilterOptionsData
  onAudienceChange: (updater: (prev: AnnouncementAudience) => AnnouncementAudience) => void
  onManualSellersChange: (updater: (prev: Record<string, ManualSellerRef>) => Record<string, ManualSellerRef>) => void
  disabled?: boolean
}

const STATUS_LABELS: Record<string, string> = { active: 'Aktif', suspended: 'Askıda' }

function updateFilters(
  audience: AnnouncementAudience,
  patch: Partial<AnnouncementAudience['filters']>,
): AnnouncementAudience {
  return { ...audience, filters: { ...audience.filters, ...patch } }
}

export function AudienceBuilder({
  audience,
  manualSellers,
  filterOptions,
  onAudienceChange,
  onManualSellersChange,
  disabled = false,
}: AudienceBuilderProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Alıcılar
        </p>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Yalnız aktif ve askıdaki satıcılar alıcı olabilir.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Alıcı seçim yöntemi">
        {(
          [
            { value: 'all', label: 'Tüm satıcılar' },
            { value: 'manual', label: 'Elle seçim' },
            { value: 'filter', label: 'Filtre' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={audience.mode === option.value}
            disabled={disabled}
            onClick={() => onAudienceChange((prev) => ({ ...prev, mode: option.value }))}
            className="rounded-full border px-3 py-1.5 text-sm font-medium"
            style={{
              borderColor: audience.mode === option.value ? 'var(--color-primary)' : 'var(--color-border)',
              backgroundColor: audience.mode === option.value ? 'var(--color-primary)' : 'transparent',
              color: audience.mode === option.value ? 'var(--color-primary-fg)' : 'var(--color-muted-fg)',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {audience.mode === 'manual' && (
        <ManualAudience
          audience={audience}
          manualSellers={manualSellers}
          onAudienceChange={onAudienceChange}
          onManualSellersChange={onManualSellersChange}
          disabled={disabled}
        />
      )}

      {audience.mode === 'filter' && (
        <FilterAudience
          audience={audience}
          filterOptions={filterOptions}
          onAudienceChange={onAudienceChange}
          disabled={disabled}
        />
      )}

      {audience.excludedSellerIds.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {audience.excludedSellerIds.length} satıcı önizleme listesinden çıkarıldı. "Alıcıları önizle" bölümünden
          geri alabilirsiniz.
        </p>
      )}
    </div>
  )
}

function ManualAudience({
  audience,
  manualSellers,
  onAudienceChange,
  onManualSellersChange,
  disabled,
}: {
  audience: AnnouncementAudience
  manualSellers: Record<string, ManualSellerRef>
  onAudienceChange: AudienceBuilderProps['onAudienceChange']
  onManualSellersChange: AudienceBuilderProps['onManualSellersChange']
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SellerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearchError(null)
      return
    }
    setSearching(true)
    setSearchError(null)
    const timeoutId = window.setTimeout(async () => {
      try {
        // csrfFetch on a GET is harmless and keeps the CSRF usage guard (which cannot tell
        // this static segment from the draft `[id]` route) satisfied.
        const response = await csrfFetch(`/api/admin/announcements/sellers?q=${encodeURIComponent(trimmed)}`)
        if (!response.ok) throw new Error('Arama başarısız.')
        const payload = (await response.json()) as { data: SellerSearchResult[] }
        setResults(payload.data)
      } catch {
        setSearchError('Satıcılar aranamadı. Lütfen tekrar deneyin.')
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => window.clearTimeout(timeoutId)
  }, [query])

  function addSeller(seller: SellerSearchResult) {
    onManualSellersChange((prev) => ({
      ...prev,
      [seller.id]: { id: seller.id, displayName: seller.displayName, status: seller.status },
    }))
    onAudienceChange((prev) =>
      prev.manualSellerIds.includes(seller.id)
        ? prev
        : { ...prev, manualSellerIds: [...prev.manualSellerIds, seller.id] },
    )
  }

  function removeSeller(id: string) {
    onAudienceChange((prev) => ({ ...prev, manualSellerIds: prev.manualSellerIds.filter((sellerId) => sellerId !== id) }))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="announcement-seller-search">Mağaza, slug veya şirket adı ara</Label>
        <Input
          id="announcement-seller-search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="En az 2 karakter yazın"
        />
      </div>

      {searching && (
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Aranıyor…
        </p>
      )}
      {searchError && (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {searchError}
        </p>
      )}

      {results.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {results.map((seller) => {
            const alreadyAdded = audience.manualSellerIds.includes(seller.id)
            return (
              <li key={seller.id} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium" style={{ color: 'var(--color-primary)' }}>
                    {seller.displayName}
                  </p>
                  <p className="truncate text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {[seller.companyName, seller.city, STATUS_LABELS[seller.status] ?? seller.status]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || alreadyAdded}
                  onClick={() => addSeller(seller)}
                >
                  {alreadyAdded ? 'Eklendi' : 'Ekle'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
          Seçilen satıcılar ({audience.manualSellerIds.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {audience.manualSellerIds.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz satıcı eklenmedi.
            </p>
          )}
          {audience.manualSellerIds.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
            >
              {manualSellers[id]?.displayName ?? id}
              <button
                type="button"
                aria-label={`${manualSellers[id]?.displayName ?? id} satıcısını kaldır`}
                disabled={disabled}
                onClick={() => removeSeller(id)}
                style={{ color: 'var(--color-destructive)' }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function CategoryOption({
  category,
  depth,
  childrenByParent,
  selected,
  onToggle,
  disabled,
}: {
  category: { id: string; name: string; parentId: string | null }
  depth: number
  childrenByParent: Map<string | null, { id: string; name: string; parentId: string | null }[]>
  selected: Set<string>
  onToggle: (id: string) => void
  disabled: boolean
}) {
  const children = childrenByParent.get(category.id) ?? []
  return (
    <>
      <div style={{ paddingLeft: depth * 16 }}>
        <Checkbox
          id={`announcement-category-${category.id}`}
          checked={selected.has(category.id)}
          disabled={disabled}
          onCheckedChange={() => onToggle(category.id)}
          label={category.name}
        />
      </div>
      {children.map((child) => (
        <CategoryOption
          key={child.id}
          category={child}
          depth={depth + 1}
          childrenByParent={childrenByParent}
          selected={selected}
          onToggle={onToggle}
          disabled={disabled}
        />
      ))}
    </>
  )
}

function FilterAudience({
  audience,
  filterOptions,
  onAudienceChange,
  disabled,
}: {
  audience: AnnouncementAudience
  filterOptions: FilterOptionsData
  onAudienceChange: AudienceBuilderProps['onAudienceChange']
  disabled: boolean
}) {
  const [locationQuery, setLocationQuery] = useState('')
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())

  const selectedStatuses = new Set(audience.filters.statuses ?? [])
  const selectedVerification = new Set(audience.filters.verification ?? [])
  const selectedLocations = audience.filters.locations ?? []
  const selectedCategoryIds = new Set(audience.filters.categoryIds ?? [])

  function toggleStatus(value: (typeof ANNOUNCEMENT_ELIGIBLE_STATUSES)[number]) {
    onAudienceChange((prev) => {
      const current = new Set(prev.filters.statuses ?? [])
      current.has(value) ? current.delete(value) : current.add(value)
      return updateFilters(prev, { statuses: [...current] })
    })
  }

  function toggleVerification(value: 'verified' | 'unverified') {
    onAudienceChange((prev) => {
      const current = new Set(prev.filters.verification ?? [])
      current.has(value) ? current.delete(value) : current.add(value)
      return updateFilters(prev, { verification: [...current] })
    })
  }

  function toggleLocation(location: { city: string; district?: string }) {
    onAudienceChange((prev) => {
      const current = prev.filters.locations ?? []
      const exists = current.some((entry) => entry.city === location.city && entry.district === location.district)
      const next = exists
        ? current.filter((entry) => !(entry.city === location.city && entry.district === location.district))
        : [...current, location]
      return updateFilters(prev, { locations: next })
    })
  }

  function toggleCategory(id: string) {
    onAudienceChange((prev) => {
      const current = new Set(prev.filters.categoryIds ?? [])
      current.has(id) ? current.delete(id) : current.add(id)
      return updateFilters(prev, { categoryIds: [...current] })
    })
  }

  function toggleCityExpanded(key: string) {
    setExpandedCities((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const filteredCities = useMemo(() => {
    const q = locationQuery.trim().toLocaleLowerCase('tr-TR')
    if (!q) return filterOptions.locations
    return filterOptions.locations.filter(
      (city) =>
        city.label.toLocaleLowerCase('tr-TR').includes(q) ||
        city.districts.some((district) => district.label.toLocaleLowerCase('tr-TR').includes(q)),
    )
  }, [filterOptions.locations, locationQuery])

  const categoryChildrenByParent = useMemo(() => {
    const map = new Map<string | null, { id: string; name: string; parentId: string | null }[]>()
    for (const category of filterOptions.categories) {
      const list = map.get(category.parentId) ?? []
      list.push(category)
      map.set(category.parentId, list)
    }
    return map
  }, [filterOptions.categories])
  const rootCategories = categoryChildrenByParent.get(null) ?? []

  return (
    <div className="space-y-6">
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Bir filtre içindeki seçenekler "veya", farklı filtreler "ve" ile birleşir.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Durum
        </legend>
        <div className="flex flex-wrap gap-4">
          {filterOptions.statuses.map((status) => (
            <Checkbox
              key={status.value}
              id={`announcement-status-${status.value}`}
              checked={selectedStatuses.has(status.value)}
              disabled={disabled}
              onCheckedChange={() => toggleStatus(status.value)}
              label={status.label}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Doğrulama
        </legend>
        <div className="flex flex-wrap gap-4">
          <Checkbox
            id="announcement-verified"
            checked={selectedVerification.has('verified')}
            disabled={disabled}
            onCheckedChange={() => toggleVerification('verified')}
            label="Doğrulanmış"
          />
          <Checkbox
            id="announcement-unverified"
            checked={selectedVerification.has('unverified')}
            disabled={disabled}
            onCheckedChange={() => toggleVerification('unverified')}
            label="Doğrulanmamış"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Kayıt tarihi
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="announcement-registered-from">Başlangıç</Label>
            <Input
              id="announcement-registered-from"
              type="date"
              disabled={disabled}
              value={audience.filters.registeredFrom ?? ''}
              onChange={(event) =>
                onAudienceChange((prev) => updateFilters(prev, { registeredFrom: event.target.value || undefined }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="announcement-registered-to">Bitiş</Label>
            <Input
              id="announcement-registered-to"
              type="date"
              disabled={disabled}
              value={audience.filters.registeredTo ?? ''}
              onChange={(event) =>
                onAudienceChange((prev) => updateFilters(prev, { registeredTo: event.target.value || undefined }))
              }
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Mağaza / şirket adı
        </legend>
        <Input
          aria-label="Mağaza veya şirket adına göre daralt"
          disabled={disabled}
          value={audience.filters.nameQuery ?? ''}
          onChange={(event) => onAudienceChange((prev) => updateFilters(prev, { nameQuery: event.target.value || undefined }))}
          placeholder="Ada göre daralt"
        />
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Konum
        </legend>
        <Input
          aria-label="Şehir veya ilçe ara"
          disabled={disabled}
          value={locationQuery}
          onChange={(event) => setLocationQuery(event.target.value)}
          placeholder="Şehir veya ilçe ara"
        />
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {filteredCities.length === 0 && (
            <p className="px-2 py-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Eşleşen şehir bulunamadı.
            </p>
          )}
          {filteredCities.map((city) => {
            const cityChecked = selectedLocations.some((entry) => entry.city === city.key && !entry.district)
            const expanded = expandedCities.has(city.key)
            return (
              <div key={city.key}>
                <div className="flex items-center gap-2 px-2 py-1">
                  <Checkbox
                    id={`announcement-city-${city.key}`}
                    checked={cityChecked}
                    disabled={disabled}
                    onCheckedChange={() => toggleLocation({ city: city.key })}
                    label={`${city.label} (${city.count})`}
                  />
                  {city.districts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleCityExpanded(city.key)}
                      className="text-xs underline-offset-2 hover:underline"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {expanded ? 'İlçeleri gizle' : 'İlçeleri göster'}
                    </button>
                  )}
                </div>
                {expanded && (
                  <div className="ml-6 space-y-1">
                    {city.districts.map((district) => {
                      const districtChecked = selectedLocations.some(
                        (entry) => entry.city === city.key && entry.district === district.key,
                      )
                      return (
                        <Checkbox
                          key={district.key}
                          id={`announcement-district-${city.key}-${district.key}`}
                          checked={districtChecked}
                          disabled={disabled}
                          onCheckedChange={() => toggleLocation({ city: city.key, district: district.key })}
                          label={`${district.label} (${district.count})`}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Kategori
        </legend>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Alt kategoriler dahil; en az bir yayındaki ürünü olan satıcılar.
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-2" style={{ borderColor: 'var(--color-border)' }}>
          {rootCategories.length === 0 && (
            <p className="px-2 py-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Kategori bulunamadı.
            </p>
          )}
          {rootCategories.map((category) => (
            <CategoryOption
              key={category.id}
              category={category}
              depth={0}
              childrenByParent={categoryChildrenByParent}
              selected={selectedCategoryIds}
              onToggle={toggleCategory}
              disabled={disabled}
            />
          ))}
        </div>
      </fieldset>
    </div>
  )
}
