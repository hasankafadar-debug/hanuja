import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

/** Failed recipients a bulk retry would requeue, and why the others are excluded. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service } = await requireAnnouncementAdmin()
    const { id } = await params
    return ok(await service.retryPreview(id))
  } catch (error) {
    return handleError(error)
  }
}
