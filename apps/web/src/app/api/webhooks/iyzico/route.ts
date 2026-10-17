/**
 * POST /api/webhooks/iyzico — iyzico doğrudan API bildirimleri.
 *
 * X-IYZ-SIGNATURE-V3 doğrulanır, bildirim önce kalıcı olarak kaydedilir, sonra 2xx döner.
 * Bildirim yalnız tetikleyicidir: karar worker'da iyzico'nun imzalı sorgu yanıtıyla verilir.
 * Kart ödemesi bayrağı kapalı olsa da çalışır (başlamış ödemeler sahipsiz kalmaz).
 *
 * See: docs/05-security/payment-security.md
 */
import type { NextRequest } from 'next/server'
import { handleIyzicoWebhook } from '@hanuja/api/routes/card-payments'

export async function POST(req: NextRequest) {
  return handleIyzicoWebhook(req)
}
