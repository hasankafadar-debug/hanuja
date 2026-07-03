import { type NextRequest } from 'next/server'
import { rejectReturnReceipt } from '@hanuja/api/routes/returns'
import { handleError } from '@hanuja/api/lib/response'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const { id } = await params
    return rejectReturnReceipt(req, id, sellerId)
  } catch (error) {
    return handleError(error)
  }
}
