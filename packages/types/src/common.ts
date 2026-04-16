export type ID = string

export type Timestamp = Date

export type Pagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type CursorPagination = {
  cursor?: string
  limit: number
  hasNextPage: boolean
  nextCursor?: string
}

export type SortDirection = 'asc' | 'desc'

export type ApiResponse<T> = {
  data: T
  success: true
}

export type ApiError = {
  success: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type Currency = 'TRY'

/** Money value — always use Decimal in DB, number here for transport */
export type MoneyAmount = number
