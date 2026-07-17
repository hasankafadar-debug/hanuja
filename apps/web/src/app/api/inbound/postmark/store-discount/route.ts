import { NextRequest, NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'
import { createCampaignDiscountService } from '@hanuja/api/services/campaign-discount.service'

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
    const fromEmail = String(payload?.From ?? '').trim()
    const replyText = String(payload?.StrippedTextReply ?? payload?.TextBody ?? '')
      .trim()
      .toLowerCase()

    if (replyText !== 'ret') {
      return NextResponse.json({ success: true, status: 'ignored' })
    }

    const prisma = createPrismaForRoute()
    const service = createStoreFollowService({ prisma })
    const updated = await service.unsubscribeByReplyEmail(fromEmail)

    // A "RET" reply also opts the sender out of all marketing (campaign) email.
    await createCampaignDiscountService({ prisma }).revokeMarketingEmailConsentByEmail(fromEmail)

    return NextResponse.json({
      success: true,
      status: updated > 0 ? 'unsubscribed' : 'no_match',
      updated,
    })
  } catch (error) {
    console.error('[postmark-store-discount-inbound] failed:', error)
    return NextResponse.json(
      { success: false, message: 'Inbound processing failed' },
      { status: 500 },
    )
  }
}
