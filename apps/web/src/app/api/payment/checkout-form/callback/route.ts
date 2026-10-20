import type { NextRequest } from 'next/server'
import { handleCheckoutFormCallback } from '@hanuja/api/routes/card-payments'

export async function POST(req: NextRequest) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '')
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is required')
  return handleCheckoutFormCallback(req, appUrl)
}
