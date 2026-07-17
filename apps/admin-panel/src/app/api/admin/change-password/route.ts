import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkUserRateLimit, HIGH_RISK_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { sendEmail } from '@hanuja/api/lib/mailer'
import { passwordChangedTemplate } from '@hanuja/api/lib/email-templates/password-changed'

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) })

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  if (session.user.role !== 'admin') return NextResponse.json({ message: 'Bu işlem admin hesabına özeldir.' }, { status: 403 })
  const limit = await checkUserRateLimit(session.user.id, 'admin:change-password', HIGH_RISK_RATE_LIMIT)
  if (!limit.allowed) return limit.response!
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Yeni parola en az 8 karakter olmalıdır.' }, { status: 400 })
  try {
    await auth.api.changePassword({ headers: request.headers, body: { ...parsed.data, revokeOtherSessions: true } })
    const template = passwordChangedTemplate({ changedAt: new Date() })
    sendEmail({ to: session.user.email, subject: template.subject, html: template.html, text: template.text }).catch(console.error)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ message: 'Mevcut parola yanlış veya parola değiştirilemedi.' }, { status: 400 })
  }
}
