import { type NextRequest } from 'next/server'
import { acceptOrderAsSeller } from '@hanuja/api/routes/orders'
import { handleError } from '@hanuja/api/lib/response'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const { id } = await params
    return acceptOrderAsSeller(id, sellerId)
  } catch (error) {
    return handleError(error)
  }
}
