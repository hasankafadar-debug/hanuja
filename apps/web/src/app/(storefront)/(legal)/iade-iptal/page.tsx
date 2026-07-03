import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import { LegalEntityBox } from '@/components/storefront/legal-entity-box'

export const metadata: Metadata = {
  title: 'İade ve İptal Koşulları | Hanuja',
  description: 'Hanuja iade, iptal, cayma hakkı, kargo ve uyuşmazlık koşulları.',
  robots: { index: true, follow: true },
}

export default function IadeIptalPage() {
  return (
    <>
      <LegalEntityBox />
      <h1>İade ve İptal Koşulları</h1>

      <p>
        Hanuja, çok satıcılı pazar yeri modeliyle çalışan elektronik ticaret aracı hizmet
        sağlayıcıdır. Ürünün satıcısı, sipariş sırasında gösterilen ilgili satıcıdır. Hanuja,
        mevzuattan doğan aracı hizmet sağlayıcı yükümlülükleri saklı kalmak üzere ürünün üreticisi,
        ithalatçısı, bayisi veya doğrudan satıcısı değildir.
      </p>

      <h2>1. Sipariş İptali</h2>
      <p>
        Sipariş kargoya verilmeden önce müşteri hesabı üzerinden iptal talebi oluşturulabilir.
        Ödeme onayı tamamlanmamış veya EFT/Havale bekleyen siparişlerde iptal ve ödeme iadesi,
        ödeme durumuna göre yürütülür. Kargoya verilmiş siparişlerde basit iptal yerine cayma,
        iade veya uyuşmazlık süreci uygulanır.
      </p>

      <h2>2. Cayma Hakkı</h2>
      <p>
        Tüketici, mal satışlarında ürünü kendisi veya belirlediği üçüncü kişi teslim aldıktan
        sonra 14 gün içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma
        hakkını kullanabilir. Tek sipariş içinde ayrı ayrı teslim edilen ürünlerde süre son ürünün
        teslimiyle başlar. Ürün teslim edilmeden önce de cayma bildirimi yapılabilir.
      </p>
      <p>
        Cayma talebi sipariş detay ekranından, destek kanallarından veya{' '}
        <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}>
          {PLATFORM_LEGAL_INFO.supportEmail}
        </a>{' '}
        adresinden iletilebilir. Hanuja, platform üzerinden aldığı talepleri ilgili satıcıya iletir
        ve sürecin kayıtlarını saklar.
      </p>

      <h2>3. İade Kargo ve Masraf Kuralı</h2>
      <p>
        Cayma hakkı kapsamında iade edilecek ürün, satıcının bildirdiği iade taşıyıcısı ve
        talimatlarına uygun gönderilmelidir. 01.01.2026 itibarıyla yürürlükteki rejim uyarınca,
        satıcının iade için belirttiği taşıyıcıyla yapılan iadelerde tüketici iade masrafından
        sorumlu tutulamaz. Satıcı ön bilgilendirmede iade taşıyıcısı belirtmemişse tüketiciden
        iade masrafı talep edilemez.
      </p>
      <p>
        Belirtilen iade taşıyıcısının tüketicinin bulunduğu yerde şubesi yoksa satıcı, ilave masraf
        talep etmeksizin ürünün alınmasını sağlamakla yükümlüdür. Tüketicinin satıcının belirlediği
        taşıyıcı dışında bir taşıyıcı talep ettiği haller ayrıca mevzuata göre değerlendirilir.
      </p>

      <h2>4. İade Süreci</h2>
      <ol>
        <li>Sipariş detay ekranından iade veya cayma talebi oluşturulur.</li>
        <li>Satıcı tarafından iade adresi, taşıyıcı ve paketleme talimatı iletilir.</li>
        <li>Müşteri ürünü makul özenle, aksesuarları ve varsa belgeleriyle birlikte gönderir.</li>
        <li>Ürün satıcıya ulaştığında satıcı ürün kabul ve inceleme sürecini tamamlar.</li>
        <li>Onaylanan iade tutarı yasal süre ve ödeme yöntemi kuralları çerçevesinde iade edilir.</li>
      </ol>

      <h2>5. Satıcı Sorumluluğundaki Haller</h2>
      <p>
        Ürün açıklaması, görsel, stok, fiyat, yasal uygunluk, fatura, garanti, servis, teslimat,
        ayıplı ürün, hasarlı ürün, yanlış ürün, eksik parça, sahte veya yasaklı ürün iddiaları
        ilgili satıcının sorumluluğundadır. Hanuja, mevzuattan doğan aracı hizmet sağlayıcı
        yükümlülükleri saklı kalmak üzere bu süreçlerde kayıt, destek, bildirim ve uyuşmazlık
        yönetimi altyapısı sağlar.
      </p>

      <h2>6. Müşteri Sorumluluğundaki Haller</h2>
      <p>
        Müşteri; teslimat ve iletişim bilgilerinin doğruluğundan, ürünü olağan gözden geçirme
        sınırını aşmayacak şekilde muhafaza etmekten, iade edilecek ürünü korumaktan ve talep
        edilen makul delilleri sunmaktan sorumludur. Yanlış adres, teslim almaktan kaçınma, yanıltıcı
        beyan, sahte delil, hileli iade, kupon suistimali, sahte yorum ve çoklu hesapla manipülasyon
        yasaktır.
      </p>

      <h2>7. Cayma Hakkının Kullanılamayabileceği Durumlar</h2>
      <ul>
        <li>Kişiye özel hazırlanan ürünler.</li>
        <li>Çabuk bozulabilen veya son kullanma tarihi geçebilecek ürünler.</li>
        <li>
          Tesliminden sonra ambalaj, bant, mühür veya koruyucu unsurları açılmış olan ve sağlık ya
          da hijyen açısından iadesi uygun olmayan ürünler.
        </li>
        <li>Başka ürünlerle karışan ve doğası gereği ayrıştırılması mümkün olmayan ürünler.</li>
        <li>Ambalajı açılmış kitap, dijital içerik ve bilgisayar sarf malzemeleri.</li>
        <li>Elektronik ortamda anında ifa edilen hizmetler veya gayrimaddi mallar.</li>
        <li>Cayma hakkı süresi bitmeden tüketicinin onayı ile ifasına başlanan hizmetler.</li>
        <li>Mevzuat gereği cayma hakkı dışında kalan diğer ürün ve hizmetler.</li>
      </ul>

      <h2>8. Hasar, Yanlış Ürün, Eksik Ürün ve Uyuşmazlık</h2>
      <p>
        Hasar, yanlış ürün, eksik parça, teslim edildi görünüp teslim edilmeme veya ürün açıklamasına
        aykırılık iddialarında fotoğraf, video, kargo tutanağı, ambalaj görüntüsü, fatura ve yazışma
        gibi deliller istenebilir. Satıcı iade talebini reddederse veya taraflar arasında uyuşmazlık
        oluşursa konu Hanuja destek/admin incelemesine taşınabilir.
      </p>
      <p>
        İnceleme süresince ilgili satıcının hakedişi bloke edilebilir. Hanuja incelemesi, tüketicinin
        Tüketici Hakem Heyeti, Tüketici Mahkemesi veya mevzuatın öngördüğü diğer başvuru yollarına
        başvurma hakkını ortadan kaldırmaz.
      </p>

      <h2>9. Destek</h2>
      <p>
        İade ve iptal süreçleriyle ilgili sorularınız için{' '}
        <a href={`mailto:${PLATFORM_LEGAL_INFO.supportEmail}`}>
          {PLATFORM_LEGAL_INFO.supportEmail}
        </a>{' '}
        adresinden veya <a href={PLATFORM_LEGAL_INFO.phoneHref}>{PLATFORM_LEGAL_INFO.phoneDisplay}</a>{' '}
        numarasından bizimle iletişime geçebilirsiniz.
      </p>
    </>
  )
}
