'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FilterBar, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@hanuja/ui'

interface Option {
  label: string
  value: string
}

interface AdminListControlsProps {
  searchValue?: string
  searchPlaceholder?: string
  statusValue?: string
  statusOptions?: Option[]
  invoiceValue?: string
  invoiceOptions?: Option[]
  importValue?: string
  importOptions?: Option[]
  sellerValue?: string
  sellerPlaceholder?: string
  fromValue?: string
  toValue?: string
  pageSize?: number
  pageSizeOptions?: number[]
  showSellerFilter?: boolean
  showDateRange?: boolean
}

export function AdminListControls({
  searchValue = '',
  searchPlaceholder = 'Ara...',
  statusValue = '',
  statusOptions = [],
  invoiceValue = '',
  invoiceOptions = [],
  importValue = '',
  importOptions = [],
  sellerValue = '',
  sellerPlaceholder = 'Satici ara',
  fromValue = '',
  toValue = '',
  pageSize = 20,
  pageSizeOptions = [10, 20, 50, 100],
  showSellerFilter = false,
  showDateRange = true,
}: AdminListControlsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [localSearch, setLocalSearch] = useState(searchValue)

  useEffect(() => {
    setLocalSearch(searchValue)
  }, [searchValue])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (localSearch !== searchValue) {
        updateParams({ q: localSearch || null, page: '1' })
      }
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [localSearch, searchValue])

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string; value: string }> = []
    if (statusValue) {
      chips.push({
        key: 'status',
        label: 'Durum',
        value: statusOptions.find((option) => option.value === statusValue)?.label ?? statusValue,
      })
    }
    if (invoiceValue) {
      chips.push({
        key: 'invoice',
        label: 'Fatura',
        value: invoiceOptions.find((option) => option.value === invoiceValue)?.label ?? invoiceValue,
      })
    }
    if (importValue) {
      chips.push({
        key: 'import',
        label: 'Hipicon izni',
        value: importOptions.find((option) => option.value === importValue)?.label ?? importValue,
      })
    }
    if (sellerValue) chips.push({ key: 'seller', label: 'Satici', value: sellerValue })
    if (fromValue) chips.push({ key: 'from', label: 'Baslangic', value: fromValue })
    if (toValue) chips.push({ key: 'to', label: 'Bitis', value: toValue })
    if (pageSize !== 20) chips.push({ key: 'pageSize', label: 'Sayfa boyutu', value: String(pageSize) })
    return chips
  }, [fromValue, importOptions, importValue, invoiceOptions, invoiceValue, pageSize, sellerValue, statusOptions, statusValue, toValue])

  function updateParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        next.delete(key)
        continue
      }
      next.set(key, value)
    }
    router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname)
  }

  function removeFilter(key: string) {
    if (key === 'pageSize') {
      updateParams({ pageSize: null, page: '1' })
      return
    }
    updateParams({ [key]: null, page: '1' })
  }

  function resetFilters() {
    const next = new URLSearchParams(searchParams.toString())
    for (const key of ['q', 'status', 'invoice', 'import', 'seller', 'from', 'to', 'page']) {
      next.delete(key)
    }
    if (pageSize === 20) {
      next.delete('pageSize')
    }
    router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname)
  }

  return (
    <FilterBar
      searchValue={localSearch}
      searchPlaceholder={searchPlaceholder}
      onSearchChange={setLocalSearch}
      activeFilters={activeFilters}
      onRemoveFilter={removeFilter}
      onReset={resetFilters}
    >
      {statusOptions.length > 0 && (
        <Select
          value={statusValue || '__all__'}
          onValueChange={(value) => updateParams({ status: value === '__all__' ? null : value, page: '1' })}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Durum" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tum durumlar</SelectItem>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {invoiceOptions.length > 0 && (
        <Select
          value={invoiceValue || '__all__'}
          onValueChange={(value) => updateParams({ invoice: value === '__all__' ? null : value, page: '1' })}
        >
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder="Fatura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tum faturalar</SelectItem>
            {invoiceOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {importOptions.length > 0 && (
        <Select
          value={importValue || '__all__'}
          onValueChange={(value) => updateParams({ import: value === '__all__' ? null : value, page: '1' })}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Hipicon izni" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tum izinler</SelectItem>
            {importOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showSellerFilter && (
        <Input
          value={sellerValue}
          onChange={(event) => updateParams({ seller: event.target.value || null, page: '1' })}
          placeholder={sellerPlaceholder}
          className="h-9 w-[180px]"
        />
      )}

      {showDateRange && (
        <Input
          type="date"
          value={fromValue}
          onChange={(event) => updateParams({ from: event.target.value || null, page: '1' })}
          className="h-9 w-[160px]"
        />
      )}

      {showDateRange && (
        <Input
          type="date"
          value={toValue}
          onChange={(event) => updateParams({ to: event.target.value || null, page: '1' })}
          className="h-9 w-[160px]"
        />
      )}

      <Select
        value={String(pageSize)}
        onValueChange={(value) => updateParams({ pageSize: value === '20' ? null : value, page: '1' })}
      >
        <SelectTrigger className="h-9 w-[120px]">
          <SelectValue placeholder="Boyut" />
        </SelectTrigger>
        <SelectContent>
          {pageSizeOptions.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option} / sayfa
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterBar>
  )
}
