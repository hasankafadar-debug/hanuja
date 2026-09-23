import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

/** The exact recipient list a send would freeze for the saved draft. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service } = await requireAnnouncementAdmin()
    const { id } = await params
    const page = Number(req.nextUrl.searchParams.get('sayfa') ?? '1') || 1
    return ok(await service.previewRecipients(id, page))
  } catch (error) {
    return handleError(error)
  }
}
