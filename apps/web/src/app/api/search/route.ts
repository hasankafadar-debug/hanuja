import { type NextRequest } from 'next/server'
import { searchProducts } from '@hanuja/api/routes/search'

// GET /api/search?q=masa&categorySlug=mobilya&page=1&limit=20&sort=price:asc
export async function GET(req: NextRequest) {
  return searchProducts(req)
}
