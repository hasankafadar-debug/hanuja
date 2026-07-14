import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = {
  title: 'Gizlilik Politikası',
  description: 'Hanuja gizlilik politikası.',
  robots: { index: true, follow: true },
}

export default function GizlilikPolitikasiPage() {
  return (
    <>
      <h1>Gizlilik Politikası</h1>

      <p>
        <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong> olarak kişisel verilerinizin
        gizliliğine önem veriyoruz. Bu politika; hangi verilerin toplandığını, nasıl kullanıldığını
        ve hangi durumlarda paylaşıldığını açıklar.
      </p>

      <h2>1. Toplanan Veriler</h2>
      <ul>
        <li>Hesap oluştururken sağladığınız kimlik ve iletişim bilgileri</li>
        <li>Teslimat adresleri ve sipariş kayıtları</li>
        <li>Ödeme işlemlerine ilişkin işlem verileri</li>
        <li>Tarayıcı, cihaz, IP ve güvenlik logları</li>
      </ul>

      <h2>2. Kullanım Amaçları</h2>
      <ul>
        <li>Sipariş ve teslimat süreçlerini yürütmek</li>
        <li>Ödeme güvenliği sağlamak</li>
        <li>Destek, iade ve şikayet taleplerini yönetmek</li>
        <li>Yasal yükümlülükleri yerine getirmek</li>
      </ul>

      <h2>3. Paylaşım</h2>
      <p>
        Verileriniz yalnızca siparişin ifası için gerekli olduğu ölçüde satıcılar, kargo firmaları,
        ödeme kuruluşları ve teknik hizmet sağlayıcılarla paylaşılır. Yasal zorunluluk halinde
        yetkili kurumlara aktarım yapılabilir.
      </p>

      <h2>4. Haklarınız</h2>
      <p>
        KVKK kapsamındaki taleplerinizi{' '}
        <a href={`mailto:${PLATFORM_LEGAL_INFO.kvkkEmail}`}>{PLATFORM_LEGAL_INFO.kvkkEmail}</a>{' '}
        adresine iletebilirsiniz.
      </p>
    </>
  )
}
