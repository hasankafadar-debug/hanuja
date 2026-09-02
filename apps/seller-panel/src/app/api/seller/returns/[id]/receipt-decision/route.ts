import { type NextRequest } from 'next/server'
import { decideQuantityReturnReceipt } from '@hanuja/api/routes/returns'
import { handleError } from '@hanuja/api/lib/response'
import { getOperationalSellerIdOrThrow } from '@/lib/route-seller'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError

  try {
    const sellerId = await getOperationalSellerIdOrThrow()
    const { id } = await params
    return decideQuantityReturnReceipt(req, id, sellerId)
  } catch (error) {
    return handleError(error)
  }
}
