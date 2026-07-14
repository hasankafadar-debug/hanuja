import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = {
  title: 'Kullanım Koşulları',
  description: 'Hanuja platform kullanım, sipariş, iade ve sorumluluk koşulları.',
  robots: { index: true, follow: true },
}

export default function KullanimKosullariPage() {
  return (
    <>
      <h1>Kullanım Koşulları</h1>

      <p>
        Bu koşullar, <strong>{PLATFORM_LEGAL_INFO.companyNameDisplay}</strong> tarafından işletilen
        Hanuja platformunu kullanan tüm ziyaretçi, müşteri ve üyeler için geçerlidir. Hanuja, çok
        satıcılı pazar yeri modeliyle çalışan elektronik ticaret aracı hizmet sağlayıcıdır.
      </p>

      <h2>1. Platformun Rolü</h2>
      <p>
        Hanuja; ürünlerin listelenmesi, sipariş akışı, ödeme yönlendirmesi, destek, kayıt saklama,
        iade/uyuşmazlık bildirimi ve operasyonel denetim altyapısı sunar. Ürünün doğrudan satıcısı,
        ürün sayfasında ve sipariş belgelerinde gösterilen ilgili satıcıdır. Hanuja, mevzuattan doğan
        aracı hizmet sağlayıcı yükümlülükleri saklı kalmak üzere ürünün üreticisi, ithalatçısı, bayisi
        veya doğrudan satıcısı değildir.
      </p>

      <h2>2. Hesap ve Bilgi Doğruluğu</h2>
      <p>
        Kullanıcılar hesap, teslimat, fatura, iletişim ve ödeme bilgilerini doğru, güncel ve eksiksiz
        sağlamakla yükümlüdür. Yanlış adres, eksik iletişim, yetkisiz ödeme aracı kullanımı veya
        yanıltıcı kimlik bilgileri nedeniyle doğan gecikme, teslim edilememe, ek maliyet ve uyuşmazlık
        kullanıcının sorumluluğundadır.
      </p>

      <h2>3. Yasaklı Kullanımlar</h2>
      <ul>
        <li>Hukuka aykırı, yanıltıcı, sahte veya üçüncü kişi haklarını ihlal eden işlem yapılamaz.</li>
        <li>Hileli iade, sahte hasar bildirimi, yanıltıcı delil veya kötü niyetli uyuşmazlık açılamaz.</li>
        <li>Kupon, kampanya, puan, yorum veya tavsiye sistemleri manipüle edilemez.</li>
        <li>Çoklu hesapla avantaj sağlama, sahte yorum, bot, scraping veya otomasyon kullanılamaz.</li>
        <li>Satıcıyla platform dışı ödeme, komisyon kaçırma veya kayıt dışı satış yönlendirmesi yapılamaz.</li>
      </ul>

      <h2>4. Sipariş, Ödeme ve Sözleşmeler</h2>
      <p>
        Sipariş verilmeden önce ürün bilgileri, satıcı bilgileri, toplam bedel, ödeme yöntemi, teslimat,
        cayma hakkı ve ön bilgilendirme metinleri kullanıcıya sunulur. Kullanıcı, sipariş öncesinde sepet,
        adres, ödeme ve ürün adetlerini kontrol edip düzeltebilir. Siparişi tamamla veya ödeme adımı,
        ödeme yükümlülüğü doğuran işlem anlamına gelir.
      </p>
      <p>
        Siparişe ait Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu sipariş bazında elektronik
        ortamda saklanır. Kabul zamanı, belge sürümü, belge hash’i, IP, user-agent ve oturum gibi
        kayıtlar uyuşmazlık ve mevzuata uyum amaçlarıyla saklanabilir.
      </p>

      <h2>5. Satıcı ve Ürün Kaynaklı Sorumluluklar</h2>
      <p>
        Ürün açıklaması, görsel, stok, fiyat, yasal uygunluk, fatura, garanti, servis, teslimat,
        ayıplı ürün, hasarlı ürün, yanlış veya eksik ürün ve satış sonrası ürün yükümlülükleri ilgili
        satıcının sorumluluğundadır. Hanuja, mevzuattan doğan yükümlülükleri saklı kalmak üzere bu
        konularda kayıt, destek ve uyuşmazlık yönetimi altyapısı sağlar.
      </p>

      <h2>6. İade, Cayma ve Uyuşmazlık</h2>
      <p>
        Tüketici mevzuatındaki cayma, iade ve başvuru hakları saklıdır. Kargoya verilmemiş siparişlerde
        iptal; kargoya verilmiş siparişlerde ise cayma, iade veya uyuşmazlık süreçleri uygulanır.
        Detaylar için <a href="/iade-iptal">İade ve İptal Koşulları</a> sayfasını inceleyebilirsiniz.
      </p>
      <p>
        Hanuja, iade veya uyuşmazlık incelemelerinde taraflardan delil isteyebilir, satıcı hakedişini
        inceleme süresince bloke edebilir, talebi reddedebilir veya mevzuat ve platform kayıtlarına göre
        işlem tesis edebilir.
      </p>

      <h2>7. Hesap Kısıtlama ve İşlem Güvenliği</h2>
      <p>
        Hanuja; dolandırıcılık şüphesi, kötüye kullanım, sahte bilgi, ödeme riski, mevzuata aykırılık,
        güvenlik ihlali veya platform dışı işlem yönlendirmesi halinde hesabı geçici veya kalıcı olarak
        kısıtlayabilir, siparişi incelemeye alabilir, destek ve uyuşmazlık kayıtlarını saklayabilir.
      </p>

      <h2>8. Sorumluluğun Sınırı</h2>
      <p>
        Hanuja, platformun makul güvenlik ve sürekliliği için gerekli önlemleri alır. Bununla birlikte
        kullanıcı cihazı, internet bağlantısı, ödeme kuruluşu, kargo şirketi, satıcı beyanı, ürün niteliği
        veya kullanıcıdan kaynaklanan durumlardan doğan zararlardan, mevzuatın emredici hükümleri saklı
        kalmak üzere, sorumlu değildir.
      </p>

      <h2>9. Başvuru ve İletişim</h2>
      <p>
        Sorularınız için <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}>{PLATFORM_LEGAL_INFO.supportEmail}</a>{' '}
        adresinden bize ulaşabilirsiniz. Tüketici uyuşmazlıklarında parasal sınırlar dahilinde yetkili
        Tüketici Hakem Heyeti, Tüketici Mahkemesi ve mevzuatın öngördüğü diğer başvuru yolları saklıdır.
      </p>
    </>
  )
}
