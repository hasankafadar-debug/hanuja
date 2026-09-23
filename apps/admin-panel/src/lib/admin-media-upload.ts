'use client'

import { csrfFetch } from './csrf-fetch'
import type { MediaAssetItem } from '@/app/(panel)/medya/_components/types'

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
  return data.message ?? data.error ?? fallback
}

/** Browser → R2 PUT with upload progress (fetch has none); large videos need it. */
function putWithProgress(url: string, file: File, onFraction: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    request.setRequestHeader('Content-Type', file.type)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onFraction(event.loaded / event.total)
    }
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error('Dosya yüklenemedi.'))
    request.onerror = () =>
      reject(new Error('Dosya yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.'))
    request.onabort = () => reject(new Error('Yükleme iptal edildi.'))
    request.send(file)
  })
}

/**
 * Three-step admin media upload: presigned URL → direct R2 PUT → server confirm.
 * The server re-checks size, type and (for announcements) the file signature on confirm.
 */
export async function uploadAdminMedia(
  file: File,
  folder: string,
  onProgress?: (percent: number) => void,
): Promise<MediaAssetItem> {
  onProgress?.(5)
  const urlResponse = await csrfFetch('/api/admin/media/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder, mimeType: file.type, originalName: file.name }),
  })
  if (!urlResponse.ok) throw new Error(await responseMessage(urlResponse, "Yükleme URL'i alınamadı."))
  const uploadData = (await urlResponse.json()) as {
    data?: { uploadUrl: string; asset?: { id: string }; assetId?: string }
    uploadUrl?: string
    asset?: { id: string }
    assetId?: string
  }
  const uploadPayload = uploadData.data ?? uploadData
  const uploadUrl = uploadPayload.uploadUrl
  const assetId = uploadPayload.assetId ?? uploadPayload.asset?.id
  if (!uploadUrl || !assetId) throw new Error('Yükleme URL bilgisi eksik.')

  onProgress?.(10)
  await putWithProgress(uploadUrl, file, (fraction) => onProgress?.(10 + Math.round(fraction * 80)))
  onProgress?.(92)

  const confirmResponse = await csrfFetch(`/api/admin/media/${assetId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!confirmResponse.ok)
    throw new Error(await responseMessage(confirmResponse, 'Dosya doğrulanamadı.'))
  const confirmData = (await confirmResponse.json()) as {
    data?: { asset: MediaAssetItem }
    asset?: MediaAssetItem
  }
  const asset = confirmData.data?.asset ?? confirmData.asset
  if (!asset) throw new Error('Medya kaydı okunamadı.')
  onProgress?.(100)
  return asset
}
