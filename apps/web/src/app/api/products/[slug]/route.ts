import { getProductBySlug } from '@hanuja/api/routes/catalog'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/products/:slug
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    return getProductBySlug(slug)
  } catch (err) {
    return handleError(err)
  }
}
