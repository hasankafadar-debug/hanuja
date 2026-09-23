import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

/** Eligible (active/suspended) sellers by store, slug or company name — manual selection. */
export async function GET(req: NextRequest) {
  try {
    const { service } = await requireAnnouncementAdmin()
    const query = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
    return ok(await service.searchSellers(query))
  } catch (error) {
    return handleError(error)
  }
}
