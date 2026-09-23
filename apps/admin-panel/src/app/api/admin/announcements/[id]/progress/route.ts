import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { isAnnouncementProgressBucket } from '@hanuja/api/domain/announcement-progress'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service } = await requireAnnouncementAdmin()
    const { id } = await params
    const bucket = req.nextUrl.searchParams.get('durum')
    const page = Number(req.nextUrl.searchParams.get('sayfa') ?? '1') || 1
    return ok(
      await service.progress(id, {
        bucket: isAnnouncementProgressBucket(bucket) ? bucket : null,
        page,
      }),
    )
  } catch (error) {
    return handleError(error)
  }
}
