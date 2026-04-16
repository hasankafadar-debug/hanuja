/**
 * Badge component — inline status or label chip.
 * CVA variants: default, secondary, outline, success, warning, destructive, info.
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-fg",
        secondary:
          "bg-secondary text-secondary-fg",
        outline:
          "border border-border text-foreground bg-transparent",
        success:
          "bg-success text-success-fg",
        warning:
          "bg-warning text-warning-fg",
        destructive:
          "bg-destructive text-destructive-fg",
        info:
          "bg-info text-info-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = ({ className, variant, ...props }: BadgeProps) => {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
