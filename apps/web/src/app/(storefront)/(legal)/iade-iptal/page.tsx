import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import { LegalEntityBox } from '@/components/storefront/legal-entity-box'

export const metadata: Metadata = {
  title: 'İade ve İptal Koşulları | Hanuja',
  description: 'Hanuja iade, iptal ve cayma hakkı koşulları.',
  robots: { index: true, follow: true },
}

export default function IadeIptalPage() {
  return (
    <>
      <LegalEntityBox />
      <h1>İade ve İptal Koşulları</h1>

      <p>
        6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği
        uyarınca iade ve iptal haklarınız aşağıda özetlenmiştir.
      </p>

      <h2>1. Cayma Hakkı</h2>
      <p>
        Siparişinizi teslim aldıktan sonra 14 gün içinde herhangi bir gerekçe göstermeksizin cayma
        hakkınızı kullanabilirsiniz. Cayma talebinizi sipariş detay sayfasından veya{' '}
        <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}>{PLATFORM_LEGAL_INFO.supportEmail}</a>{' '}
        adresi üzerinden iletebilirsiniz.
      </p>

      <h2>2. İade Süreci</h2>
      <ol>
        <li>Sipariş detay ekranından iade veya iptal talebi oluşturun.</li>
        <li>Size iletilen yönlendirme doğrultusunda ürünü satıcıya gönderin.</li>
        <li>Ürün satıcıya ulaştıktan sonra kontrol süreci tamamlanır.</li>
        <li>Onaylanan iade tutarı, yasal süre içinde ödemenize iade edilir.</li>
      </ol>

      <h2>3. Cayma Hakkının Kullanılamadığı Durumlar</h2>
      <ul>
        <li>Kişiye özel hazırlanan ürünler</li>
        <li>Hijyen veya sağlık nedeniyle iadesi uygun olmayan ve koruyucu unsurları açılmış ürünler</li>
        <li>Çabuk bozulabilen ürünler</li>
        <li>Elektronik ortamda anında ifa edilen dijital içerikler</li>
        <li>Mevzuat gereği cayma hakkı tanınmayan diğer ürün ve hizmetler</li>
      </ul>

      <h2>4. Sipariş İptali</h2>
      <p>
        Sipariş henüz kargoya verilmediyse müşteri hesabınız üzerinden iptal talebi oluşturabilirsiniz.
        Kargoya verilmiş siparişlerde iade süreci uygulanır.
      </p>

      <h2>5. Destek</h2>
      <p>
        İade ve iptal süreçleriyle ilgili sorularınız için{' '}
        <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}>{PLATFORM_LEGAL_INFO.supportEmail}</a>{' '}
        adresinden veya <a href={PLATFORM_LEGAL_INFO.phoneHref}>{PLATFORM_LEGAL_INFO.phoneDisplay}</a>{' '}
        numarasından bizimle iletişime geçebilirsiniz.
      </p>
    </>
  )
}
