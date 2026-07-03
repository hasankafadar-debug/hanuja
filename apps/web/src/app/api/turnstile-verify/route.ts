import { NextRequest, NextResponse } from 'next/server'
import { verifyTurnstileToken } from '@hanuja/api/lib/turnstile'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string; action?: string } | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, message: 'Gecersiz istek govdesi.' }, { status: 400 })
  }

  const token = body.token ?? ''
  const action = body.action
  const rawIp =
    req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? undefined

  const result = await verifyTurnstileToken({
    token,
    ...(action !== undefined && { action }),
    ...(rawIp !== undefined && { ip: rawIp }),
  })

  if (!result.success) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
