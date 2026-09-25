import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCustomerCampaignService } from '@hanuja/api/services/customer-campaign.service'
import { getMarketingChannelStatus } from '@hanuja/api/services/marketing-channel.service'
import { getAdminSession } from '@/lib/admin-session'
import { NewCampaignButton } from './_components/new-campaign-button'
import { ChannelControl } from './_components/channel-control'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Müşteri Kampanyaları', robots: { index: false, follow: false } }

export default async function CustomerCampaignsPage({ searchParams }: { searchParams: Promise<{ kanal?: string; sayfa?: string }> }) {
  await getAdminSession()
  const query = await searchParams
  const channel = query.kanal === 'sms' ? 'sms' : 'email'
  const page = Math.max(1, Number.parseInt(query.sayfa ?? '1', 10) || 1)
  const prisma = createPrismaForRoute()
  const [data, emailStatus, smsStatus] = await Promise.all([
    createCustomerCampaignService({ prisma }).listForAdmin(channel, page),
    getMarketingChannelStatus(prisma, 'email'),
    getMarketingChannelStatus(prisma, 'sms'),
  ])
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  return <div className="space-y-6">
    <PageHeader title="Müşteri Kampanyaları" description="Müşterilere yönelik e-posta ve SMS taslakları. Satıcı duyurularından ayrıdır." actions={<NewCampaignButton channel={channel} />} />
    <nav aria-label="Kampanya kanalı" className="flex gap-2">
      <Link href="/musteri-kampanyalari?kanal=email" aria-current={channel === 'email' ? 'page' : undefined} className={`rounded-lg border px-4 py-2 text-sm ${channel === 'email' ? 'font-semibold' : ''}`}>E-posta</Link>
      <Link href="/musteri-kampanyalari?kanal=sms" aria-current={channel === 'sms' ? 'page' : undefined} className={`rounded-lg border px-4 py-2 text-sm ${channel === 'sms' ? 'font-semibold' : ''}`}>SMS</Link>
    </nav>
    <div className="rounded-xl border p-4 text-sm" style={{ backgroundColor: 'var(--color-surface)' }}>
      <div className="grid gap-4 md:grid-cols-2"><ChannelControl channel="email" initial={emailStatus} /><ChannelControl channel="sms" initial={smsStatus} /></div>
      <p className="mt-2">E-posta sağlayıcısı: Resend. SMS sağlayıcısı: yapılandırılmadı. İYS: yapılandırılmadı.</p>
      <p className="mt-2">Sağlayıcıya aktarılmış veya sonucu belirsiz mesajlar geri alınamaz. Kanalı yeniden açmak eski gönderimleri canlandırmaz.</p>
      <p className="mt-2" style={{ color: 'var(--color-muted-fg)' }}>{channel === 'sms' ? 'SMS sağlayıcısı ve İYS bağlantısı yapılandırılmadı.' : 'İYS bağlantısı yapılandırılmadı.'} Taslak oluşturabilir ve önizleyebilirsiniz; gönderim kullanılamaz.</p>
    </div>
    <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: 'var(--color-surface)' }}>
      <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="px-4 py-3">Başlık</th><th className="px-4 py-3">Durum</th><th className="px-4 py-3">Alıcı</th><th className="px-4 py-3">Oluşturma</th></tr></thead>
      <tbody>{data.rows.length ? data.rows.map((row) => <tr key={row.id} className="border-t"><td className="px-4 py-3"><Link className="underline" href={`/musteri-kampanyalari/${row.id}`}>{row.title || 'Başlıksız taslak'}</Link></td><td className="px-4 py-3">{row.status === 'draft' ? 'Taslak' : 'Gönderime alındı'}</td><td className="px-4 py-3">{row.recipientCount}</td><td className="px-4 py-3">{row.createdAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</td></tr>) : <tr><td colSpan={4} className="px-4 py-10 text-center">Bu kanalda kampanya yok.</td></tr>}</tbody></table>
    </div>
    <div className="flex gap-4 text-sm">{page > 1 && <Link href={`?kanal=${channel}&sayfa=${page - 1}`}>Önceki</Link>}{page < pages && <Link href={`?kanal=${channel}&sayfa=${page + 1}`}>Sonraki</Link>}</div>
  </div>
}
