'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import type { CustomerCampaignAudience } from '@hanuja/api/domain/customer-campaign'
import { MediaSection, type MediaState } from '../../duyurular/[id]/_components/media-section'

type Campaign = { id: string; channel: 'email' | 'sms'; status: string; version: number; title: string; body: string; ctaLabel: string | null; ctaUrl: string | null; audience: CustomerCampaignAudience; media: { id: string; kind: 'image' | 'video'; url: string } | null; poster: { id: string; url: string } | null }
type Customer = { id: string; name: string | null; email: string }
type Preview = { count: number; audienceHash: string; rows: Customer[]; eligibility: { missingConsent: number; iysUnverified: number; dailyLimit: number; eligible: number } }
async function request(path: string, method = 'GET', body?: unknown) {
  const res = await csrfFetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const value = await res.json()
  if (!res.ok) throw new Error(value.message ?? 'İşlem tamamlanamadı.')
  return value.data
}
export function CampaignEditor({ initial }: { initial: Campaign }) {
  const router = useRouter()
  const [draft, setDraft] = useState(initial)
  const [media, setMedia] = useState<MediaState>({ mediaAssetId: initial.media?.id ?? null, mediaKind: initial.media?.kind ?? null, mediaUrl: initial.media?.url ?? null, posterAssetId: initial.poster?.id ?? null, posterUrl: initial.poster?.url ?? null })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [email, setEmail] = useState<{html: string; text: string} | null>(null)
  const [view, setView] = useState<'desktop' | 'mobile' | 'text'>(initial.channel === 'sms' ? 'text' : 'desktop')
  const [progress, setProgress] = useState<Record<string, number> | null>(null)
  const locked = initial.status !== 'draft'
  const path = `/api/admin/customer-campaigns/${initial.id}`
  const inputClass = 'mt-1 w-full rounded border bg-transparent px-3 py-2 text-sm'
  function audience(next: Partial<CustomerCampaignAudience>) { setDraft(value => ({ ...value, audience: { ...value.audience, ...next } })); setPreview(null) }
  async function save() {
    const result = await request(path, 'PATCH', { version: draft.version, title: draft.title, body: draft.body, ctaLabel: draft.ctaLabel, ctaUrl: draft.ctaUrl, mediaAssetId: media.mediaAssetId, posterAssetId: media.posterAssetId, audience: draft.audience })
    setDraft(value => ({ ...value, version: result.version }))
    return result.version as number
  }
  async function action(task: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await task() } catch (error) { setMessage(error instanceof Error ? error.message : 'İşlem tamamlanamadı.') }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    <Link href="/musteri-kampanyalari" className="text-sm underline">Müşteri kampanyalarına dön</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{initial.channel === 'email' ? 'E-posta' : 'SMS'} kampanyası</h1>
      <Button variant="outline" disabled={busy} onClick={() => void action(async () => { const result = await request(`${path}/copy`, 'POST', { version: draft.version }); router.push(`/musteri-kampanyalari/${result.id}`) })}>Kopyala</Button>
    </div>
    <div className="rounded-lg border p-4 text-sm">Gönderim kapalı. İYS bağlantısı yapılandırılmadı.{initial.channel === 'sms' && ' SMS sağlayıcısı bulunmuyor; ücret ve segment hesabı henüz sunulmuyor.'} Sağlayıcıya aktarılmış veya sonucu belirsiz iletiler geri alınamaz.</div>
    {message && <p role="status" className="rounded border p-3 text-sm">{message}</p>}
    <fieldset disabled={busy || locked} className="space-y-4 rounded-xl border p-5">
      <legend className="px-2 font-medium">İçerik</legend>
      <label className="block text-sm">{initial.channel === 'email' ? 'E-posta konusu' : 'Kampanya adı'}<input maxLength={150} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className={inputClass} /></label>
      <label className="block text-sm">Mesaj metni<textarea rows={7} maxLength={5000} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} className={inputClass} /></label>
      {initial.channel === 'email' && <>
        <div className="grid gap-4 md:grid-cols-2"><label className="text-sm">Bağlantı metni<input value={draft.ctaLabel ?? ''} onChange={e => setDraft({ ...draft, ctaLabel: e.target.value || null })} className={inputClass} /></label><label className="text-sm">Hanuja bağlantısı<input type="url" value={draft.ctaUrl ?? ''} onChange={e => setDraft({ ...draft, ctaUrl: e.target.value || null })} className={inputClass} /></label></div>
        <MediaSection value={media} onChange={setMedia} disabled={busy || locked} />
      </>}
    </fieldset>
    <fieldset disabled={busy || locked} className="space-y-4 rounded-xl border p-5"><legend className="px-2 font-medium">Alıcı seçimi</legend>
      <label className="block text-sm">Hedef kitle<select className={inputClass} value={draft.audience.mode} onChange={e => audience({ mode: e.target.value as CustomerCampaignAudience['mode'] })}><option value="all">Tüm uygun müşteriler</option><option value="manual">Elle seçilen müşteriler</option><option value="filter">Kayıt tarihi aralığı</option></select></label>
      {draft.audience.mode === 'filter' && <div className="grid gap-4 md:grid-cols-2">{(['registeredFrom', 'registeredTo'] as const).map(key => <label key={key} className="text-sm">{key === 'registeredFrom' ? 'Başlangıç tarihi' : 'Bitiş tarihi'}<input type="date" className={inputClass} value={draft.audience.filters[key] ?? ''} onChange={e => audience({ filters: { ...draft.audience.filters, [key]: e.target.value || undefined } })} /></label>)}</div>}
      <div className="flex items-end gap-3"><label className="flex-1 text-sm">Müşteri ara (seçmek veya hariç tutmak için)<input className={inputClass} value={query} onChange={e => setQuery(e.target.value)} /></label><Button variant="outline" disabled={query.trim().length < 2} onClick={() => void action(async () => setCustomers(await request(`/api/admin/customer-campaigns/customers?q=${encodeURIComponent(query)}`)))}>Ara</Button></div>
      {customers.map(customer => <div key={customer.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm"><span>{customer.name} · {customer.email}</span><div className="flex gap-3">{draft.audience.mode === 'manual' && <label><input type="checkbox" checked={draft.audience.manualUserIds.includes(customer.id)} onChange={e => audience({ manualUserIds: e.target.checked ? [...new Set([...draft.audience.manualUserIds, customer.id])] : draft.audience.manualUserIds.filter(id => id !== customer.id) })} /> Seç</label>}<label><input type="checkbox" checked={draft.audience.excludedUserIds.includes(customer.id)} onChange={e => audience({ excludedUserIds: e.target.checked ? [...new Set([...draft.audience.excludedUserIds, customer.id])] : draft.audience.excludedUserIds.filter(id => id !== customer.id) })} /> Hariç tut</label></div></div>)}
      <p className="text-sm">Elle seçilen: {draft.audience.manualUserIds.length} · Hariç tutulan: {draft.audience.excludedUserIds.length}</p>
    </fieldset>
    <div className="flex flex-wrap gap-3">{!locked && <><Button disabled={busy} onClick={() => void action(async () => { await save(); setMessage('Taslak kaydedildi.') })}>Taslağı kaydet</Button><Button variant="outline" disabled={busy} onClick={() => void action(async () => { await save(); setPreview(await request(`${path}/recipients`)) })}>Alıcı önizlemesi</Button></>}
      <Button variant="outline" disabled={busy} onClick={() => void action(async () => { if (!locked) await save(); setEmail(await request(`${path}/email-preview`)) })}>İçerik önizlemesi</Button>
      <Button disabled title="İYS ve kanal altyapısı hazır değil">Gönderim kapalı</Button>
      {locked && <Button variant="outline" disabled={busy} onClick={() => void action(async () => { const result = await request(`${path}/progress`); setProgress(result.counts) })}>Sonuçları yenile</Button>}
    </div>
    {preview && <section className="space-y-3 rounded-xl border p-5"><h2 className="font-medium">Alıcı önizlemesi</h2><p className="text-sm">Aday: {preview.count} · İzin eksik: {preview.eligibility.missingConsent} · İYS doğrulanmamış: {preview.eligibility.iysUnverified} · Günlük limite takılan: {preview.eligibility.dailyLimit} · Gönderilebilir: {preview.eligibility.eligible}</p><p className="text-xs">Gönderim anında adres, izin, İYS, kanal ve limitler yeniden kontrol edilir.</p>{preview.rows.map(row => <p key={row.id} className="text-sm">{row.name} · {row.email}</p>)}</section>}
    {progress && <section className="rounded-xl border p-5"><h2 className="font-medium">Gönderim sonuçları</h2>{Object.entries(progress).map(([status, count]) => <p key={status}>{status}: {count}</p>)}<Button disabled title="İYS ve kanal altyapısı hazır değil">Kesin başarısızları yeniden dene</Button></section>}
    {email && <section className="space-y-3 rounded-xl border p-5"><h2 className="font-medium">İçerik önizlemesi</h2><div className="flex gap-2">{(['desktop', 'mobile', 'text'] as const).map(mode => <Button key={mode} variant="outline" onClick={() => setView(mode)}>{mode === 'desktop' ? 'Masaüstü' : mode === 'mobile' ? 'Mobil' : 'Düz metin'}</Button>)}</div>{view === 'text' ? <pre className="whitespace-pre-wrap text-sm">{email.text}</pre> : <iframe sandbox="" title="Kampanya önizlemesi" srcDoc={email.html} className="mx-auto h-[650px] max-w-full rounded border" style={{ width: view === 'mobile' ? 375 : '100%' }} />}</section>}
  </div>
}
