'use client'

import * as React from 'react'
import { Bell } from 'lucide-react'
import { Button } from '../button'
import { Badge } from '../badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog'
import { Separator } from '../separator'
import { Skeleton } from '../skeleton'
import { cn } from '../../lib/utils'
import { csrfHeaders } from '../../lib/csrf-headers'

export interface Notification {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
  href?: string | null
}

export interface NotificationBellProps {
  /** API base path — defaults to '/api/notifications' */
  apiPath?: string
  className?: string
}

/**
 * NotificationBell — displays unread count badge and a dropdown list.
 *
 * Fetches from `{apiPath}` on mount and after marking as read.
 * Works for both the storefront (/api/notifications) and seller panel.
 */
export function NotificationBell({
  apiPath = '/api/notifications',
  className,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [notifications, setNotifications] = React.useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [error, setError] = React.useState('')
  const readingIds = React.useRef(new Set<string>())

  const fetchNotifications = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiPath}?limit=15`)
      if (!res.ok) throw new Error('list failed')
      const json = await res.json()
      setNotifications(json.data?.items ?? [])
      setUnreadCount(json.data?.unreadCount ?? 0)
      setError('')
    } catch {
      setError('Bildirimler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [apiPath])

  // Load on mount for the badge count
  React.useEffect(() => {
    void fetchNotifications()
  }, [fetchNotifications])

  // Reload when dropdown opens
  React.useEffect(() => {
    if (open) void fetchNotifications()
  }, [open, fetchNotifications])

  async function markAllRead() {
    try {
      const response = await fetch(apiPath, {
        method: 'POST',
        headers: csrfHeaders(apiPath),
      })
      if (!response.ok) throw new Error('read failed')
      setUnreadCount(0)
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          readAt: n.readAt ?? new Date().toISOString(),
        })),
      )
      setError('')
    } catch {
      setError('Bildirimler okundu olarak işaretlenemedi.')
    }
  }

  async function markRead(id: string) {
    if (readingIds.current.has(id)) return
    readingIds.current.add(id)
    const url = `${apiPath}/${encodeURIComponent(id)}/read`
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: csrfHeaders(url),
        keepalive: true,
      })
      if (!response.ok) throw new Error('read failed')
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch {
      setError('Bildirim okundu olarak işaretlenemedi.')
    } finally {
      readingIds.current.delete(id)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className={cn('relative', className)}
          aria-label={`Bildirimler${unreadCount > 0 ? ` (${unreadCount} okunmamış)` : ''}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-md max-h-[80vh] flex flex-col p-0"
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base">
              Bildirimler
              {unreadCount > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {unreadCount} yeni
                </Badge>
              )}
            </DialogTitle>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Tümünü okundu say
              </button>
            )}
          </div>
          <DialogDescription className="sr-only">
            Panel bildirimleri ve ilgili kayıtlara bağlantılar
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          )}

          {!loading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-3 opacity-30" />
              <p className="text-sm">Henüz bildirim yok</p>
            </div>
          )}

          {!loading && notifications.length > 0 && (
            <ul>
              {notifications.map((notification, idx) => {
                const Item = notification.href ? 'a' : 'button'
                return (
                  <li key={notification.id}>
                    <Item
                      href={notification.href ?? undefined}
                      type={notification.href ? undefined : 'button'}
                      className={cn(
                        'block w-full px-4 py-3 text-left cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                        !notification.readAt && 'bg-primary/5',
                      )}
                      onClick={() => {
                        if (!notification.readAt) void markRead(notification.id)
                        if (notification.href) setOpen(false)
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {!notification.readAt && (
                          <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                        )}
                        <div className={cn('flex-1 min-w-0', notification.readAt && 'pl-4')}>
                          <p className="text-sm font-medium leading-snug">{notification.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                            {notification.body}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {formatRelativeTime(notification.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Item>
                    {idx < notifications.length - 1 && <Separator />}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {error ? (
          <p role="alert" className="px-4 pb-3 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Az önce'
  if (diffMins < 60) return `${diffMins} dakika önce`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} saat önce`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays} gün önce`
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
}
