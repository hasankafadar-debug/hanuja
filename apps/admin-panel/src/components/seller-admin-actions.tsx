'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

const DOC_TYPES = [
  { value: 'identity', label: 'Kimlik Belgesi' },
  { value: 'tax_certificate', label: 'Vergi Levhası' },
  { value: 'trade_registry', label: 'Ticaret Sicil Gazetesi' },
  { value: 'signature_circular', label: 'İmza Sirküleri' },
  { value: 'bank_statement', label: 'Banka Hesap Belgesi' },
  { value: 'other', label: 'Diğer' },
] as const

export function SellerAdminActions({ sellerId }: { sellerId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState<'documents' | 'reset' | null>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(['identity', 'tax_certificate', 'bank_statement'])
  const [note, setNote] = useState('')

  async function requestDocuments() {
    setLoading('documents')
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/request-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requiredDocTypes: selected, note: note || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert((body as { message?: string }).message ?? 'İşlem başarısız.')
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function resetPassword() {
    if (!confirm('Bu satıcının şifresi sıfırlansın mı? E-posta ile sıfırlama bağlantısı gidecek.')) return
    setLoading('reset')
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin reset' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert((body as { message?: string }).message ?? 'İşlem başarısız.')
        return
      }
      alert('Şifre sıfırlama e-postası gönderildi.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={loading !== null}>
        Belge İste
      </Button>
      <Button size="sm" variant="outline" onClick={resetPassword} disabled={loading !== null}>
        Şifre Sıfırla
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">Talep edilecek belgeler</h2>
            <div className="mt-4 grid gap-3">
              {DOC_TYPES.map((doc) => (
                <label key={doc.value} className="flex items-center gap-3 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={selected.includes(doc.value)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...new Set([...prev, doc.value])] : prev.filter((item) => item !== doc.value),
                      )
                    }
                  />
                  {doc.label}
                </label>
              ))}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opsiyonel not"
              rows={3}
              className="mt-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={loading !== null}>
                Vazgeç
              </Button>
              <Button size="sm" onClick={requestDocuments} disabled={selected.length === 0 || loading !== null}>
                Gönder
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
