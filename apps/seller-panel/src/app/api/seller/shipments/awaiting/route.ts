import { type NextRequest } from 'next/server'
import { markAwaitingShipment } from '@hanuja/api/routes/shipments'
import { handleError } from '@hanuja/api/lib/response'
import { getOperationalSellerIdOrThrow } from '@/lib/route-seller'

export async function POST(req: NextRequest) {
  try {
    const sellerId = await getOperationalSellerIdOrThrow()
    return markAwaitingShipment(req, sellerId)
  } catch (error) {
    return handleError(error)
  }
}
