/**
 * Server-side helper: resolves the authenticated admin from the current session.
 * Redirects to /giris if unauthenticated or not admin role.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'

export async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/giris')
  }
  if (session.user.role !== 'admin') {
    redirect('/giris')
  }
  return session
}
