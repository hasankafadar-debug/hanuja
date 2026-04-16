import { listCategories } from '@hanuja/api/routes/catalog'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/categories — root categories with children
export async function GET() {
  try {
    return listCategories()
  } catch (err) {
    return handleError(err)
  }
}
