/**
 * Server-side helper: resolves the authenticated admin from the current session.
 * Redirects to /giris if unauthenticated or not admin role.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { auth } from './auth'

export const getAdminSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/giris')
  }
  if (session.user.role !== 'admin') {
    redirect('/giris')
  }
  return session
})
