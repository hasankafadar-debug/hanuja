import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = {
  title: 'Kullanım Koşulları | Hanuja',
  description: 'Hanuja platform kullanım koşulları.',
  robots: { index: true, follow: true },
}

export default function KullanimKosullariPage() {
  return (
    <>
      <h1>Kullanım Koşulları</h1>

      <p>
        Bu koşullar, <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong> tarafından işletilen
        Hanuja platformunu kullanan tüm ziyaretçi, müşteri ve satıcılar için geçerlidir.
      </p>

      <h2>1. Hesap ve Üyelik</h2>
      <p>
        Kullanıcılar doğru, güncel ve eksiksiz bilgi vermekle yükümlüdür. Hesap güvenliği
        kullanıcıya aittir.
      </p>

      <h2>2. Platform Kullanımı</h2>
      <ul>
        <li>Yasadışı veya yanıltıcı işlem yapılamaz.</li>
        <li>Başkalarının haklarını ihlal eden içerik paylaşılamaz.</li>
        <li>Platform altyapısına zarar verecek otomasyon veya kötüye kullanım yapılamaz.</li>
      </ul>

      <h2>3. Ödeme ve Teslimat</h2>
      <p>
        Sipariş bedelleri güvenli ödeme altyapısı üzerinden tahsil edilir. Ürünün satışı ve ifası
        ilgili satıcı sorumluluğundadır; platform aracılık hizmeti sunar.
      </p>

      <h2>4. İade ve Cayma</h2>
      <p>
        Teslimattan sonra tüketici mevzuatı kapsamındaki haklar geçerlidir. Detaylar için{' '}
        <a href="/iade-iptal">İade ve İptal Koşulları</a> sayfasını inceleyebilirsiniz.
      </p>

      <h2>5. İletişim</h2>
      <p>
        Sorularınız için <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}>{PLATFORM_LEGAL_INFO.supportEmail}</a>{' '}
        adresinden bize ulaşabilirsiniz.
      </p>
    </>
  )
}
