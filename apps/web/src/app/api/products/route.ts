import { type NextRequest } from 'next/server'
import { listProducts } from '@hanuja/api/routes/catalog'
import { handleError } from '@hanuja/api/lib/response'

// GET /api/products?categoryId=...&skip=0&take=20
export async function GET(req: NextRequest) {
  try {
    return listProducts(req)
  } catch (err) {
    return handleError(err)
  }
}
