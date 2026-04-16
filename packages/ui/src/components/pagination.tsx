/**
 * Pagination component — prev/next/page buttons with current page indicator.
 */
"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"
import { cn } from "../lib/utils"

export interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
  /** Max page buttons to show (excluding prev/next). Default: 5 */
  maxVisible?: number
}

function getPageNumbers(current: number, total: number, max: number): (number | "ellipsis")[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1)

  const half = Math.floor(max / 2)
  let start = Math.max(1, current - half)
  const end = Math.min(total, start + max - 1)

  if (end - start < max - 1) {
    start = Math.max(1, end - max + 1)
  }

  const pages: (number | "ellipsis")[] = []
  if (start > 1) {
    pages.push(1)
    if (start > 2) pages.push("ellipsis")
  }
  for (let i = start; i <= end; i++) pages.push(i)
  if (end < total) {
    if (end < total - 1) pages.push("ellipsis")
    pages.push(total)
  }
  return pages
}

function Pagination({ page, totalPages, onPageChange, className, maxVisible = 5 }: PaginationProps) {
  const pages = getPageNumbers(page, totalPages, maxVisible)

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex items-center gap-1", className)}
    >
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Önceki sayfa"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md border border-border text-sm transition-colors",
          "hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((p, i) =>
        p === "ellipsis" ? (
          <span key={`ellipsis-${i}`} className="flex h-9 w-9 items-center justify-center text-muted-fg">
            <MoreHorizontal className="h-4 w-4" />
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors",
              p === page
                ? "bg-primary text-primary-fg"
                : "border border-border hover:bg-muted"
            )}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Sonraki sayfa"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md border border-border text-sm transition-colors",
          "hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  )
}

export { Pagination }
