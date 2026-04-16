/**
 * Spinner component — animated loading indicator.
 * Size variants: sm, md, lg. Accessible with role="status".
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const spinnerVariants = cva(
  "animate-spin rounded-full border-2 border-current border-t-transparent",
  {
    variants: {
      size: {
        sm: "h-4 w-4",
        md: "h-6 w-6",
        lg: "h-8 w-8",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

export interface SpinnerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof spinnerVariants> {
  label?: string
}

const Spinner = ({ className, size, label = "Yükleniyor...", ...props }: SpinnerProps) => {
  return (
    <div role="status" aria-label={label} className={cn("inline-flex", className)} {...props}>
      <div className={spinnerVariants({ size })} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export { Spinner }
