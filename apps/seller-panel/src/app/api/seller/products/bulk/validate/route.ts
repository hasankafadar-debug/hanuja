import { NextRequest } from 'next/server'
import { POST as validateBulkRequest } from '../route'

/** Validate a bulk file without creating any products. */
export async function POST(req: NextRequest) {
  const headers = new Headers(req.headers)
  headers.set('x-hanuja-bulk-validate', '1')
  return validateBulkRequest(new NextRequest(req.url, { method: 'POST', headers, body: await req.text() }))
}
