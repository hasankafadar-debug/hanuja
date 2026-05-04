'use client'

import { useCallback, useMemo, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hanuja/ui'
import { readApiData } from './api'
import { PromoEditor } from './promo-editor'
import { SliderList } from './slider-list'
import type { HomeCmsInitialData, HomePromoItem, HomePromoSlot, HomeSlideItem } from './types'

interface Props {
  initialData: HomeCmsInitialData
}

export function HomeCmsManager({ initialData }: Props) {
  const [slides, setSlides] = useState<HomeSlideItem[]>(initialData.slides)
  const [promos, setPromos] = useState<HomePromoItem[]>(initialData.promos)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const response = await fetch('/api/admin/home-cms', { cache: 'no-store' })
    const data = await readApiData<{ slides: HomeSlideItem[]; promos: HomePromoItem[] }>(response)
    setSlides(data.slides)
    setPromos(data.promos)
  }, [])

  const promoBySlot = useMemo(() => {
    return promos.reduce<Partial<Record<HomePromoSlot, HomePromoItem>>>((acc, promo) => {
      acc[promo.slot] = promo
      return acc
    }, {})
  }, [promos])

  return (
    <div className="space-y-4">
      {message && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        >
          {message}
        </div>
      )}

      <Tabs defaultValue="slides">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="slides">Slayt Yönetimi</TabsTrigger>
          <TabsTrigger value="top">Üst Promo</TabsTrigger>
          <TabsTrigger value="bottom">Alt Promo</TabsTrigger>
        </TabsList>

        <TabsContent value="slides">
          <SliderList
            slides={slides}
            sellers={initialData.sellers}
            onSlidesChange={setSlides}
            onRefresh={refresh}
            onMessage={setMessage}
          />
        </TabsContent>

        <TabsContent value="top">
          <PromoEditor
            slot="TOP_RIGHT"
            title="Üst Promo"
            promo={promoBySlot.TOP_RIGHT ?? null}
            onRefresh={refresh}
            onMessage={setMessage}
          />
        </TabsContent>

        <TabsContent value="bottom">
          <PromoEditor
            slot="BOTTOM_RIGHT"
            title="Alt Promo"
            promo={promoBySlot.BOTTOM_RIGHT ?? null}
            onRefresh={refresh}
            onMessage={setMessage}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
