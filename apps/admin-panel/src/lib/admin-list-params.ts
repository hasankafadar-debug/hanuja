export type RawAdminSearchParams = Record<string, string | string[] | undefined>

export interface AdminListParams {
  q: string
  status: string[]
  invoice: string
  from: string
  to: string
  seller: string
  page: number
  pageSize: number
}

export function parseAdminListParams(
  searchParams: RawAdminSearchParams | undefined,
  defaults: Partial<AdminListParams> = {},
): AdminListParams {
  const q = readSingle(searchParams, 'q') ?? defaults.q ?? ''
  const status = readMulti(searchParams, 'status')
  const invoice = readSingle(searchParams, 'invoice') ?? defaults.invoice ?? ''
  const from = readSingle(searchParams, 'from') ?? defaults.from ?? ''
  const to = readSingle(searchParams, 'to') ?? defaults.to ?? ''
  const seller = readSingle(searchParams, 'seller') ?? defaults.seller ?? ''
  const page = clampNumber(readSingle(searchParams, 'page'), defaults.page ?? 1, 1, 9999)
  const pageSize = clampNumber(readSingle(searchParams, 'pageSize'), defaults.pageSize ?? 20, 5, 100)

  return {
    q,
    status: status.length > 0 ? status : defaults.status ?? [],
    invoice,
    from,
    to,
    seller,
    page,
    pageSize,
  }
}

export function buildDateRange(params: Pick<AdminListParams, 'from' | 'to'>) {
  return {
    ...(params.from ? { from: new Date(`${params.from}T00:00:00.000Z`) } : {}),
    ...(params.to ? { to: new Date(`${params.to}T23:59:59.999Z`) } : {}),
  }
}

export function getPagination(params: Pick<AdminListParams, 'page' | 'pageSize'>) {
  return {
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
  }
}

export function getPrimaryStatusValue(status: string[]) {
  return status.join(',')
}

function readSingle(searchParams: RawAdminSearchParams | undefined, key: string) {
  const raw = searchParams?.[key]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

function readMulti(searchParams: RawAdminSearchParams | undefined, key: string) {
  const raw = searchParams?.[key]
  if (Array.isArray(raw)) {
    return raw.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((value) => value.trim()).filter(Boolean)
  }
  return []
}

function clampNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}
