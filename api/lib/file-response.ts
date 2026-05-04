function buildAsciiFallback(fileName: string) {
  const normalized = fileName.normalize('NFKD').replace(/[^\x20-\x7E]+/g, '-')
  const sanitized = normalized.replace(/["\\]/g, '').replace(/[;]+/g, '-').trim()
  return sanitized.length > 0 ? sanitized : 'dosya'
}

export function buildContentDisposition(
  fileName: string,
  disposition: 'inline' | 'attachment' = 'attachment',
) {
  const asciiFallback = buildAsciiFallback(fileName)
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export function createBinaryFileResponse(params: {
  body: Uint8Array
  contentType: string
  fileName: string
  disposition?: 'inline' | 'attachment'
  sizeBytes?: number
}) {
  const disposition = buildContentDisposition(params.fileName, params.disposition ?? 'attachment')
  const body = Buffer.from(params.body)
  return new Response(body, {
    headers: {
      'Content-Type': params.contentType,
      'Content-Disposition': disposition,
      'Cache-Control': 'private, no-store',
      ...(params.sizeBytes !== undefined
        ? { 'Content-Length': String(params.sizeBytes) }
        : {}),
    },
  })
}

export function createHtmlDownloadResponse(params: {
  html: string
  fileName: string
}) {
  return new Response(params.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': buildContentDisposition(params.fileName, 'attachment'),
      'Cache-Control': 'private, no-store',
    },
  })
}
