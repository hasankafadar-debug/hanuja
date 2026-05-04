import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import { LegalEntityBox } from '@/components/storefront/legal-entity-box'

export const metadata: Metadata = {
  title: 'KVKK Aydınlatma Metni | Hanuja',
  description: 'Hanuja kişisel verilerin korunması kanunu kapsamında aydınlatma metni.',
  robots: { index: true, follow: true },
}

export default function KvkkPage() {
  return (
    <>
      <LegalEntityBox />
      <h1>KVKK Aydınlatma Metni</h1>
      <p>
        6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel verileriniz veri sorumlusu
        sıfatıyla <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong> tarafından işlenmektedir.
      </p>

      <h2>1. Veri Sorumlusu</h2>
      <p>
        Unvan: <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong>
        <br />
        Adres: {PLATFORM_LEGAL_INFO.address}
        <br />
        E-posta: <a href={`mailto:${PLATFORM_LEGAL_INFO.kvkkEmail}`}>{PLATFORM_LEGAL_INFO.kvkkEmail}</a>
        <br />
        Telefon: <a href={PLATFORM_LEGAL_INFO.phoneHref}>{PLATFORM_LEGAL_INFO.phoneDisplay}</a>
      </p>

      <h2>2. İşlenen Veri Kategorileri</h2>
      <ul>
        <li>Kimlik ve iletişim bilgileri</li>
        <li>Teslimat ve sipariş bilgileri</li>
        <li>Ödeme güvenliği için gerekli işlem verileri</li>
        <li>İade, talep ve müşteri hizmetleri kayıtları</li>
        <li>Güvenlik logları ve işlem güvenliği verileri</li>
      </ul>

      <h2>3. İşleme Amaçları</h2>
      <ul>
        <li>Siparişlerin kurulması, teslimatı ve satış sonrası süreçlerin yürütülmesi</li>
        <li>Ödeme güvenliği ve dolandırıcılık önleme kontrolleri</li>
        <li>Müşteri destek, iade ve şikayet yönetimi</li>
        <li>Vergi, faturalama ve diğer yasal yükümlülüklerin yerine getirilmesi</li>
      </ul>

      <h2>4. Aktarım Yapılan Taraflar</h2>
      <ul>
        <li>İlgili siparişi ifa eden satıcılar</li>
        <li>Kargo ve lojistik hizmet sağlayıcıları</li>
        <li>Ödeme kuruluşları ve teknik altyapı sağlayıcıları</li>
        <li>Yetkili kamu kurum ve kuruluşları</li>
      </ul>

      <h2>5. Başvuru Haklarınız</h2>
      <p>
        KVKK’nın 11. maddesi kapsamındaki taleplerinizi{' '}
        <a href={`mailto:${PLATFORM_LEGAL_INFO.kvkkEmail}`}>{PLATFORM_LEGAL_INFO.kvkkEmail}</a>{' '}
        adresine iletebilir veya yazılı olarak şirket adresimize gönderebilirsiniz.
      </p>
    </>
  )
}
