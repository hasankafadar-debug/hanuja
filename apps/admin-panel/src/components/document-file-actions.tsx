'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@hanuja/ui'
import { Download, ExternalLink, Eye, Loader2 } from 'lucide-react'

interface DocumentFileActionsProps {
  documentId: string
  fileName: string
  mimeType: string
}

export function DocumentFileActions({
  documentId,
  fileName,
  mimeType,
}: DocumentFileActionsProps) {
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewRequest = useRef<AbortController | null>(null)
  const fileUrl = `/api/admin/documents/${documentId}/file`
  const isImage = mimeType.startsWith('image/')

  useEffect(() => {
    return () => {
      previewRequest.current?.abort()
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function openImagePreview() {
    setOpen(true)
    setLoading(true)
    setError(null)
    previewRequest.current?.abort()
    const controller = new AbortController()
    previewRequest.current = controller

    try {
      const response = await fetch(fileUrl, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null
        throw new Error(payload?.message ?? 'Belge önizlemesi yüklenemedi.')
      }

      const nextUrl = URL.createObjectURL(await response.blob())
      setPreviewUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl)
        return nextUrl
      })
    } catch (previewError) {
      if (controller.signal.aborted) return
      setError(
        previewError instanceof Error
          ? previewError.message
          : 'Belge önizlemesi yüklenemedi.',
      )
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      previewRequest.current?.abort()
      setError(null)
      setLoading(false)
      setPreviewUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl)
        return null
      })
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {isImage ? (
          <Button type="button" variant="outline" size="sm" onClick={openImagePreview}>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Önizle
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Önizle
            </a>
          </Button>
        )}
        <Button asChild variant="ghost" size="sm">
          <a href={`${fileUrl}?download=1`}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            İndir
          </a>
        </Button>
      </div>

      {isImage && (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0">
            <DialogHeader className="border-b px-6 py-4 pr-12">
              <DialogTitle>Belge önizlemesi</DialogTitle>
              <DialogDescription className="break-all">{fileName}</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-64 items-center justify-center overflow-auto bg-black/5 p-4 sm:min-h-96">
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-fg" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Belge yükleniyor…
                </div>
              ) : error ? (
                <div className="max-w-md space-y-3 text-center">
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={openImagePreview}>
                    Tekrar dene
                  </Button>
                </div>
              ) : previewUrl ? (
                // The object URL is produced from an authenticated, no-store response;
                // Next/Image cannot forward the administrator session to its optimizer.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={`${fileName} belge önizlemesi`}
                  className="max-h-[70vh] max-w-full object-contain"
                />
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
