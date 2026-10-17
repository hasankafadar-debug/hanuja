/**
 * POST /api/payment/callback — iyzico 3D Secure dönüşü (tarayıcı form POST'u).
 *
 * Callback'teki hiçbir değer tek başına başarı sayılmaz: deneme conversationId ile bulunur,
 * paymentId başlatmada kaydedilenle eşleşmeli, imza (varsa) doğrulanır ve tahsilat yalnız
 * imzalı v2 auth yanıtıyla onaylanır. Kart ödemesi bayrağı kapalı olsa da başlamış ödemeler
 * burada tamamlanır.
 */
import type { NextRequest } from 'next/server'
import { handleCardCallback } from '@hanuja/api/routes/card-payments'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('NEXT_PUBLIC_APP_URL is required in production')
      })()
    : 'http://localhost:3000')

export async function POST(req: NextRequest) {
  return handleCardCallback(req, APP_URL)
}
