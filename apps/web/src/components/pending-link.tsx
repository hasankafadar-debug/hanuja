'use client'

import * as React from 'react'
import Link, { useLinkStatus } from 'next/link'
import { Loader2 } from 'lucide-react'

type PendingLinkProps = React.ComponentProps<typeof Link> & {
  pendingLabel?: string
}

function PendingLinkContent({
  children,
  pendingLabel,
}: {
  children: React.ReactNode
  pendingLabel: string
}) {
  const { pending } = useLinkStatus()
  const [showPending, setShowPending] = React.useState(false)

  React.useEffect(() => {
    if (!pending) {
      setShowPending(false)
      return
    }

    const timeoutId = window.setTimeout(() => setShowPending(true), 100)
    return () => window.clearTimeout(timeoutId)
  }, [pending])

  return (
    <span className="inline-grid items-center">
      <span
        className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5"
        aria-hidden={showPending}
        style={{ visibility: showPending ? 'hidden' : 'visible' }}
      >
        {children}
      </span>
      <span
        className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5"
        role={showPending ? 'status' : undefined}
        aria-label={pendingLabel}
        aria-live="polite"
        aria-hidden={!showPending}
        style={{ visibility: showPending ? 'visible' : 'hidden' }}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span>{pendingLabel}</span>
      </span>
    </span>
  )
}

export const PendingLink = React.forwardRef<HTMLAnchorElement, PendingLinkProps>(
  ({ children, pendingLabel = 'Yükleniyor', ...props }, ref) => {
    return (
      <Link ref={ref} {...props}>
        <PendingLinkContent pendingLabel={pendingLabel}>{children}</PendingLinkContent>
      </Link>
    )
  },
)
PendingLink.displayName = 'PendingLink'
