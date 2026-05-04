'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Pagination } from '@hanuja/ui'

export function UrlPagination({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (totalPages <= 1) return null

  return (
    <Pagination
      page={page}
      totalPages={totalPages}
      onPageChange={(nextPage) => {
        const params = new URLSearchParams(searchParams.toString())
        if (nextPage <= 1) {
          params.delete('page')
        } else {
          params.set('page', String(nextPage))
        }
        router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname)
      }}
    />
  )
}
