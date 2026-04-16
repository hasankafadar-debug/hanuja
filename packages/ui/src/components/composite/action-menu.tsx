/**
 * ActionMenu — DropdownMenu-based row action list for tables.
 * Accepts an array of action items with icons and optional destructive styling.
 */
"use client"

import * as React from "react"
import { MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "../dropdown-menu"
import { Button } from "../button"
import { cn } from "../../lib/utils"

export interface ActionItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  /** Insert a separator above this item */
  separator?: boolean
}

export interface ActionMenuProps {
  items: ActionItem[]
  label?: string
  /** Optional section label shown at top of menu */
  menuLabel?: string
  align?: "start" | "end"
  className?: string
}

function ActionMenu({ items, label = "İşlemler", menuLabel, align = "end", className }: ActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 w-8 p-0", className)}
          aria-label={label}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-40">
        {menuLabel && <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>}
        {items.map((item, i) => (
          <React.Fragment key={i}>
            {item.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={item.onClick}
              disabled={item.disabled ?? false}
              className={cn(
                "flex items-center gap-2",
                item.destructive && "text-destructive focus:text-destructive focus:bg-destructive/10"
              )}
            >
              {item.icon && (
                <span className="h-4 w-4 shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ActionMenu }
