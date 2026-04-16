/**
 * PageHeader — consistent page-level header for panel pages.
 * Has title, optional description, breadcrumb slot (top), and action slot (right).
 */
import * as React from "react"
import { cn } from "../../lib/utils"

export interface PageHeaderProps {
  title: string
  description?: string
  /** Breadcrumb component goes here */
  breadcrumb?: React.ReactNode
  /** Buttons/actions go here — rendered on the right */
  actions?: React.ReactNode
  className?: string
}

function PageHeader({ title, description, breadcrumb, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {breadcrumb && <div>{breadcrumb}</div>}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{title}</h1>
          {description && (
            <p className="text-sm text-muted-fg">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}

export { PageHeader }
