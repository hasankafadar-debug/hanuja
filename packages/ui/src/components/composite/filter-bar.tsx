/**
 * FilterBar — horizontal search + filter chip row for list/table pages.
 * Search input on the left, filter chips in the middle, reset on the right.
 */
"use client"

import * as React from "react"
import { Search, X } from "lucide-react"
import { cn } from "../../lib/utils"

export interface FilterChip {
  key: string
  label: string
  value: string
}

export interface FilterBarProps {
  searchValue?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void
  activeFilters?: FilterChip[]
  onRemoveFilter?: (key: string) => void
  onReset?: () => void
  children?: React.ReactNode
  className?: string
}

function FilterBar({
  searchValue = "",
  searchPlaceholder = "Ara...",
  onSearchChange,
  activeFilters = [],
  onRemoveFilter,
  onReset,
  children,
  className,
}: FilterBarProps) {
  const hasFilters = searchValue.length > 0 || activeFilters.length > 0

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Search */}
      {onSearchChange && (
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-fg"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className={cn(
              "h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm",
              "placeholder:text-muted-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            )}
          />
        </div>
      )}

      {/* Extra filter controls slot */}
      {children}

      {/* Active filter chips */}
      {activeFilters.map((chip) => (
        <button
          key={chip.key}
          onClick={() => onRemoveFilter?.(chip.key)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-xs font-medium",
            "hover:border-destructive hover:text-destructive transition-colors"
          )}
        >
          {chip.label}: <span className="font-semibold">{chip.value}</span>
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      ))}

      {/* Reset */}
      {hasFilters && onReset && (
        <button
          onClick={onReset}
          className="inline-flex h-7 items-center gap-1 text-xs text-muted-fg hover:text-destructive transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Filtreleri Temizle
        </button>
      )}
    </div>
  )
}

export { FilterBar }
