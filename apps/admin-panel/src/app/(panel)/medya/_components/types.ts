export interface MediaAssetItem {
  id: string
  kind: string
  url: string
  folder: string | null
  originalName: string | null
  mimeType: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  durationSec: number | null
  variants: Record<string, string> | null
  status: string
  createdAt: string
}
