/**
 * Alert component — informational/status message block.
 * CVA variants: default, info, success, warning, destructive.
 * Supports an optional icon slot via iconSlot prop.
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 flex gap-3 items-start [&>svg]:shrink-0 [&>svg]:mt-0.5",
  {
    variants: {
      variant: {
        default:
          "bg-background border-border text-foreground",
        info:
          "bg-info/10 border-info/30 text-info-fg [&>svg]:text-info",
        success:
          "bg-success/10 border-success/30 text-success-fg [&>svg]:text-success",
        warning:
          "bg-warning/10 border-warning/30 text-warning-fg [&>svg]:text-warning",
        destructive:
          "bg-destructive/10 border-destructive/30 text-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  iconSlot?: React.ReactNode
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, iconSlot, children, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {iconSlot}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
)
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-0 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
