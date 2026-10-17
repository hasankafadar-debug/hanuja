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
  /**
   * "attention" tints the card green to signal there is live work in this
   * queue. The admin dashboard sets it for any metric whose count is above zero.
   * "warning" tints it yellow for items that need the user's eye (the seller
   * dashboard's unread product questions).
   *
   * Colors are literal hex rather than `bg-success/10` on purpose: the Tailwind
   * preset declares colors as bare `var(--color-*)` with no `<alpha-value>`
   * placeholder, so every `/NN` opacity utility is dropped at build time and
   * would render nothing.
   */
  tone?: "default" | "attention" | "warning"
}

const TONE_CLASSES = {
  default: { card: undefined, value: undefined, icon: "bg-primary/10 text-primary" },
  attention: { card: "border-[#86efac] bg-[#f0fdf4]", value: "text-success", icon: "bg-[#dcfce7] text-success" },
  warning: { card: "border-[#fde047] bg-[#fefce8]", value: "text-[#a16207]", icon: "bg-[#fef9c3] text-[#a16207]" },
} as const

function StatCard({ title, value, changePercent, changeLabel, icon, className, tone = "default" }: StatCardProps) {
  const isPositive = changePercent != null && changePercent > 0
  const isNegative = changePercent != null && changePercent < 0
  const isNeutral = changePercent == null || changePercent === 0
  const toneClasses = TONE_CLASSES[tone]
  const needsAction = tone !== "default"

  return (
    <Card
      className={cn(toneClasses.card, className)}
      data-testid="stat-card"
      data-tone={tone}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm text-muted-fg truncate">{title}</p>
            <p className={cn("text-2xl font-bold tracking-tight truncate", toneClasses.value)}>{value}</p>
            {/* Color must never be the only carrier of meaning — see .claude/rules/03-ui-design-system.md */}
            {needsAction && <span className="sr-only">İşlem bekliyor</span>}
            {changePercent != null && (
              <div
                className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  isPositive && "text-success",
                  isNegative && "text-destructive",
                  isNeutral && "text-muted-fg",
                )}
              >
                {isPositive && <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
                {isNegative && <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                {isNeutral && <Minus className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>
                  {isPositive ? "+" : ""}
                  {changePercent}%{changeLabel ? ` ${changeLabel}` : ""}
                </span>
              </div>
            )}
          </div>
          {icon && (
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                toneClasses.icon,
              )}
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
