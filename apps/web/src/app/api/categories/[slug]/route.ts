import { getCategoryBySlug } from '@hanuja/api/routes/catalog'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/categories/:slug
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    return getCategoryBySlug(slug)
  } catch (err) {
    return handleError(err)
  }
}
