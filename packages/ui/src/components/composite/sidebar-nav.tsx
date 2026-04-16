/**
 * SidebarNav — operational sidebar navigation for seller and admin panels.
 * Supports section grouping, icons, active state, and badge counts.
 */
"use client"

import * as React from "react"
import { cn } from "../../lib/utils"

export interface NavItem {
  label: string
  href: string
  icon?: React.ReactNode
  badge?: string | number
  disabled?: boolean
}

export interface NavSection {
  title?: string
  items: NavItem[]
}

export interface SidebarNavProps {
  sections: NavSection[]
  /** Current pathname for active detection */
  pathname?: string
  className?: string
}

function SidebarNav({ sections, pathname = "", className }: SidebarNavProps) {
  return (
    <nav className={cn("flex flex-col gap-6", className)}>
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="flex flex-col gap-1">
          {section.title && (
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-fg">
              {section.title}
            </p>
          )}
          {section.items.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href))

            return (
              <a
                key={item.href}
                href={item.disabled ? undefined : item.href}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={item.disabled}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-fg"
                    : "text-muted-fg hover:bg-muted hover:text-primary",
                  item.disabled && "pointer-events-none opacity-50"
                )}
              >
                {item.icon && (
                  <span
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-primary-fg" : "text-muted-fg group-hover:text-primary"
                    )}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge != null && (
                  <span
                    className={cn(
                      "ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold",
                      isActive
                        ? "bg-primary-fg/20 text-primary-fg"
                        : "bg-muted text-muted-fg"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </a>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export { SidebarNav }
