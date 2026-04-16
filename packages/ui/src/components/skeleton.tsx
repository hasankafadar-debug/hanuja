/**
 * Skeleton component — shimmer loading placeholder.
 * Pass className to control size; shimmer animation is built-in.
 */
import * as React from "react"
import { cn } from "../lib/utils"

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

const Skeleton = ({ className, ...props }: SkeletonProps) => {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
      aria-hidden="true"
      {...props}
    />
  )
}

export { Skeleton }
