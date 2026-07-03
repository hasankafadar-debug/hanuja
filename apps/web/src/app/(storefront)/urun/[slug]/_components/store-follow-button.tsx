'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, useToast } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface StoreFollowButtonProps {
  sellerId: string
}

export function StoreFollowButton({ sellerId }: StoreFollowButtonProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isFollowing, setIsFollowing] = useState(false)
  const [known, setKnown] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true

    async function loadState() {
      try {
        const res = await fetch(`/api/store-follows/${sellerId}`, { cache: 'no-store' })
        if (res.status === 401) {
          if (active) setIsFollowing(false)
          return
        }
        if (!res.ok) return
        const payload = await res.json().catch(() => null)
        if (active) setIsFollowing(Boolean(payload?.data?.isFollowing))
      } finally {
        if (active) setKnown(true)
      }
    }

    void loadState()
    return () => {
      active = false
    }
  }, [sellerId])

  async function handleToggle() {
    const nextState = !isFollowing
    setLoading(true)
    try {
      const res = await csrfFetch(`/api/store-follows/${sellerId}`, {
        method: nextState ? 'POST' : 'DELETE',
      })

      if (res.status === 401) {
        router.push(`/giris?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`)
        return
      }

      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        toast({
          title: 'Takip işlemi başarısız',
          description: payload?.error ?? 'Lütfen tekrar deneyin.',
          variant: 'destructive',
        })
        return
      }

      setIsFollowing(nextState)
      setKnown(true)
      toast({
        title: nextState ? 'Mağaza takip edildi' : 'Mağaza takibi bırakıldı',
        description: nextState
          ? 'Bu mağaza indirim yaptığında size bildirim göndereceğiz.'
          : 'Bu mağaza için indirim bildirimi almayacaksınız.',
        variant: 'success',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button type="button" size="sm" variant={known && isFollowing ? 'secondary' : 'outline'} disabled={loading} onClick={handleToggle}>
      {loading ? 'İşleniyor...' : known && isFollowing ? 'Takibi Bırak' : 'Takip Et'}
    </Button>
  )
}
