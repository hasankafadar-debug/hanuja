'use client'

import { useRouter } from 'next/navigation'
import { Pagination } from '@hanuja/ui'

interface CategoryPaginationProps {
  currentPage: number
  totalPages: number
  categoryPath: string
  basePath?: string
}

export function CategoryPagination({
  currentPage,
  totalPages,
  categoryPath,
  basePath,
}: CategoryPaginationProps) {
  const router = useRouter()

  function handlePageChange(page: number) {
    router.push(`${basePath ?? `/kategori/${categoryPath}`}?sayfa=${page}`)
  }

  return (
    <Pagination
      page={currentPage}
      totalPages={totalPages}
      onPageChange={handlePageChange}
    />
  )
}
