import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

/** Rendered e-mail as JSON; the editor shows the HTML in a sandboxed srcdoc iframe. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service } = await requireAnnouncementAdmin()
    const { id } = await params
    return ok(await service.renderEmailPreview(id))
  } catch (error) {
    return handleError(error)
  }
}
