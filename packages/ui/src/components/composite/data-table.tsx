/**
 * DataTable — generic typed table with sortable columns, loading skeleton, empty state.
 * Usage: <DataTable columns={columns} data={rows} loading={false} />
 */
"use client"

import * as React from "react"
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { cn } from "../../lib/utils"
import { Skeleton } from "../skeleton"
import { EmptyState } from "../empty-state"

export interface Column<T> {
  key: keyof T
  header: string
  sortable?: boolean
  align?: "left" | "center" | "right"
  className?: string
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  /** Key field for React keys — defaults to "id" */
  rowKey?: keyof T
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: React.ReactNode
  className?: string
}

type SortDirection = "asc" | "desc" | null

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  rowKey = "id" as keyof T,
  onRowClick,
  emptyTitle = "Sonuç bulunamadı",
  emptyDescription,
  emptyIcon,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<keyof T | null>(null)
  const [sortDir, setSortDir] = React.useState<SortDirection>(null)

  function handleSort(key: keyof T) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir("asc")
    } else if (sortDir === "asc") {
      setSortDir("desc")
    } else {
      setSortKey(null)
      setSortDir(null)
    }
  }

  const sorted = React.useMemo(() => {
    if (!sortKey || !sortDir) return data
    return [...data].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const dir = sortDir === "asc" ? 1 : -1
      if (av === bv) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return String(av).localeCompare(String(bv), "tr") * dir
    })
  }, [data, sortKey, sortDir])

  const alignClass = (align?: "left" | "center" | "right") =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"

  return (
    <div className={cn("w-full overflow-auto rounded-lg border border-border", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className={cn(
                  "px-4 py-3 font-medium text-muted-fg",
                  alignClass(col.align),
                  col.className,
                  col.sortable && "cursor-pointer select-none hover:text-primary"
                )}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    <span className="text-muted-fg/50" aria-hidden="true">
                      {sortKey === col.key ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-border">
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8">
                <EmptyState
                  icon={emptyIcon}
                  title={emptyTitle}
                  {...(emptyDescription != null ? { description: emptyDescription } : {})}
                  className="border-none bg-transparent"
                />
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={String(row[rowKey])}
                className={cn(
                  "border-b border-border transition-colors last:border-0",
                  onRowClick && "cursor-pointer hover:bg-muted/40"
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className={cn("px-4 py-3", alignClass(col.align), col.className)}
                  >
                    {col.render
                      ? col.render(row[col.key], row)
                      : (row[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export { DataTable }
