/**
 * Avatar component — user/seller profile picture with initials fallback.
 * Size variants: sm (32px), md (40px), lg (56px), xl (80px).
 */
"use client"

import * as React from "react"
import { cn } from "../lib/utils"

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-xl",
}

export interface AvatarProps {
  src?: string | null
  alt?: string
  initials?: string
  size?: keyof typeof sizeClasses
  className?: string
}

function getInitials(name?: string): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  const first = parts[0] ?? ""
  const last = parts[parts.length - 1] ?? ""
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase()
}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ src, alt, initials, size = "md", className }, ref) => {
    const [imgError, setImgError] = React.useState(false)
    const showImage = src && !imgError

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-fg overflow-hidden select-none",
          sizeClasses[size],
          className
        )}
      >
        {showImage ? (
          <img
            src={src}
            alt={alt ?? "avatar"}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <span aria-hidden="true">
            {initials ?? getInitials(alt)}
          </span>
        )}
      </span>
    )
  }
)
Avatar.displayName = "Avatar"

export { Avatar }
