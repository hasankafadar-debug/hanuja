import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

interface ExportRequestBody {
  ids?: unknown
}

function parseIds(body: ExportRequestBody) {
  if (!Array.isArray(body.ids)) return []

  return body.ids
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as ExportRequestBody
  const ids = parseIds(body)
  const prisma = createPrismaForRoute()

  const assets = await prisma.mediaAsset.findMany({
    where: {
      uploadedBy: session.user.id,
      folder: 'products',
      status: 'ready',
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
    },
    select: {
      id: true,
      url: true,
      originalName: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const orderedAssets =
    ids.length > 0
      ? (() => {
          const assetMap = new Map(assets.map((asset) => [asset.id, asset]))
          return ids
            .map((id) => assetMap.get(id))
            .filter((asset): asset is (typeof assets)[number] => Boolean(asset))
        })()
      : assets

  if (orderedAssets.length === 0) {
    return NextResponse.json(
      { error: ids.length > 0 ? 'Secilen medya bulunamadi.' : 'Indirilecek medya bulunamadi.' },
      { status: 404 },
    )
  }

  const workbook = XLSX.utils.book_new()
  const rows = [
    ['Dosya Adi', 'URL', 'Yuklenme Tarihi'],
    ...orderedAssets.map((asset) => [
      asset.originalName ?? 'Adsiz gorsel',
      asset.url,
      asset.createdAt.toLocaleString('tr-TR'),
    ]),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 28 }, { wch: 90 }, { wch: 24 }]
  XLSX.utils.book_append_sheet(workbook, sheet, 'Medya URLleri')

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="medya-urlleri.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
