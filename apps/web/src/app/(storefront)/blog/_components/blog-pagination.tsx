'use client'

import { useRouter } from 'next/navigation'
import { Pagination } from '@hanuja/ui'

export function BlogPagination({
  currentPage,
  totalPages,
}: {
  currentPage: number
  totalPages: number
}) {
  const router = useRouter()

  return (
    <Pagination
      page={currentPage}
      totalPages={totalPages}
      onPageChange={(page) => {
        const target = page <= 1 ? '/blog' : `/blog?page=${page}`
        router.push(target)
      }}
    />
  )
}
