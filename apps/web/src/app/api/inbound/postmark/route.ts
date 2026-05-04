import { NextRequest, NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'

export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
}

function basicAuthIsValid(req: NextRequest) {
  const expectedUser = process.env['POSTMARK_INBOUND_WEBHOOK_USER']
  const expectedPass = process.env['POSTMARK_INBOUND_WEBHOOK_PASS']
  if (!expectedUser || !expectedPass) return process.env.NODE_ENV !== 'production'

  const header = req.headers.get('authorization')
  if (!header?.startsWith('Basic ')) return false

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  if (separator === -1) return false

  const user = decoded.slice(0, separator)
  const pass = decoded.slice(separator + 1)
  return user === expectedUser && pass === expectedPass
}

export async function POST(req: NextRequest) {
  if (!basicAuthIsValid(req)) return unauthorized()

  try {
    const payload = await req.json()
    const service = createOrderDocumentService({ prisma: createPrismaForRoute() })
    const result = await service.ingestPostmarkInboundEmail(payload)

    if (result.status === 'unknown_alias') {
      return NextResponse.json(
        { success: false, status: result.status },
        { status: 403 },
      )
    }

    return NextResponse.json({ success: true, status: result.status })
  } catch (error) {
    console.error('[postmark-inbound] failed:', error)
    return NextResponse.json(
      { success: false, message: 'Inbound processing failed' },
      { status: 500 },
    )
  }
}
