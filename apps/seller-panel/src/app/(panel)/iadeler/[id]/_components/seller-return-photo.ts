/** Seller-side 3-step return media upload (presigned R2), folder='returns'. */
export async function uploadSellerReturnPhoto(file: File): Promise<string> {
  const urlRes = await fetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder: 'returns',
      mimeType: file.type,
      originalName: file.name,
    }),
  })
  if (!urlRes.ok) throw new Error('Yükleme URL alınamadı.')
  const { data } = await urlRes.json()
  const assetId: string = data.asset.id

  const putRes = await fetch(data.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })
  if (!putRes.ok) throw new Error('Dosya yüklenemedi.')

  const confirmRes = await fetch(`/api/media/${assetId}/confirm`, { method: 'POST' })
  if (!confirmRes.ok) throw new Error('Dosya doğrulanamadı.')
  return assetId
}

export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_FILES = 5
