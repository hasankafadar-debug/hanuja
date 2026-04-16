'use client'

import { useRouter } from 'next/navigation'
import { Pagination } from '@hanuja/ui'

interface CategoryPaginationProps {
  currentPage: number
  totalPages: number
  categoryPath: string
}

export function CategoryPagination({
  currentPage,
  totalPages,
  categoryPath,
}: CategoryPaginationProps) {
  const router = useRouter()

  function handlePageChange(page: number) {
    router.push(`/kategori/${categoryPath}?sayfa=${page}`)
  }

  return (
    <Pagination
      page={currentPage}
      totalPages={totalPages}
      onPageChange={handlePageChange}
    />
  )
}
