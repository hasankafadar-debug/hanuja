import { type NextRequest } from 'next/server'
import { fetchPublicMedia } from '@hanuja/api/routes/media'

export async function GET(req: NextRequest) {
  return fetchPublicMedia(req)
}
