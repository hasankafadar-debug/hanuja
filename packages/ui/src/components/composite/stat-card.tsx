/**
 * StatCard — dashboard metric card with title, value, change indicator, and icon.
 * Used in admin and seller panel dashboards.
 */
import * as React from "react"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "../../lib/utils"
import { Card, CardContent } from "../card"

export interface StatCardProps {
  title: string
  value: string | number
  /** Change percentage — positive = up, negative = down, undefined = neutral */
  changePercent?: number
  changeLabel?: string
  icon?: React.ReactNode
  className?: string
}

function StatCard({ title, value, changePercent, changeLabel, icon, className }: StatCardProps) {
  const isPositive = changePercent != null && changePercent > 0
  const isNegative = changePercent != null && changePercent < 0
  const isNeutral = changePercent == null || changePercent === 0

  return (
    <Card className={cn("", className)} data-testid="stat-card">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm text-muted-fg truncate">{title}</p>
            <p className="text-2xl font-bold tracking-tight truncate">{value}</p>
            {changePercent != null && (
              <div
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  isPositive && "text-success",
                  isNegative && "text-destructive",
                  isNeutral && "text-muted-fg"
                )}
              >
                {isPositive && <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
                {isNegative && <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                {isNeutral && <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>
                  {isPositive ? "+" : ""}
                  {changePercent}%
                  {changeLabel ? ` ${changeLabel}` : ""}
                </span>
              </div>
            )}
          </div>
          {icon && (
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden="true"
            >
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export { StatCard }
