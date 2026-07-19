import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { sendEmail } from '@hanuja/api/lib/mailer'
import { passwordChangedTemplate } from '@hanuja/api/lib/email-templates/password-changed'
import { customerPasswordSchema } from '@hanuja/security/password-policy'

const schema = z.object({ currentPassword: z.string().min(1), newPassword: customerPasswordSchema })

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  if (session.user.role !== 'customer') return NextResponse.json({ message: 'Bu işlem müşteri hesabına özeldir.' }, { status: 403 })
  const limit = await checkUserRateLimit(session.user.id, 'customer:change-password', HIGH_RISK_RATE_LIMIT)
  if (!limit.allowed) return limit.response!
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? 'Geçersiz parola.' }, { status: 400 })
  try {
    await auth.api.changePassword({ headers: request.headers, body: { ...parsed.data, revokeOtherSessions: true } })
    const template = passwordChangedTemplate({ changedAt: new Date() })
    sendEmail({ to: session.user.email, subject: template.subject, html: template.html, text: template.text }).catch(console.error)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ message: 'Mevcut parola yanlış veya parola değiştirilemedi.' }, { status: 400 })
  }
}
