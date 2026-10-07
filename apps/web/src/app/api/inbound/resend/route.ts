import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleResendInvoiceWebhook } from '@hanuja/api/routes/resend-inbound'

export const dynamic = 'force-dynamic'

export function POST(request: Request) {
  return handleResendInvoiceWebhook(request, createPrismaForRoute)
}
