import type { Metadata } from 'next'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import {
  COOKIE_CATEGORY_LABELS,
  COOKIE_POLICY_UPDATED_AT,
  COOKIE_POLICY_VERSION,
  getBaseCookieInventory,
} from '@hanuja/api/lib/cookie-policy'
import { CookiePreferencesButton } from '@/components/cookie-consent/cookie-preferences-button'

export const metadata: Metadata = {
  title: 'Çerez Aydınlatma Metni',
  description:
    'Hanuja internet sitesinde kullanılan çerezler ve benzeri teknolojiler, kullanım amaçları, süreleri ve hukuki sebepleri.',
  robots: { index: true, follow: true },
}

const STORAGE_LABELS = {
  cookie: 'Çerez',
  localStorage: 'Tarayıcı depolaması (localStorage)',
} as const

export default function CookiePolicyPage() {
  const info = PLATFORM_LEGAL_INFO
  // The published table always shows the real inventory, never the E2E fixture entries.
  const inventory = getBaseCookieInventory()

  return (
    <>
      <h1>Hanuja Çerez Aydınlatma Metni</h1>
      <p>
        <strong>Son Güncelleme: {COOKIE_POLICY_UPDATED_AT}</strong>
      </p>
      <p>
        Bu Çerez Aydınlatma Metni, veri sorumlusu <strong>{info.companyLegalName}</strong> tarafından
        www.hanuja.com.tr internet sitesinde kullanılan çerezler ve benzeri teknolojiler hakkında ziyaretçileri
        bilgilendirmek amacıyla hazırlanmıştır.
      </p>

      <h2>1. Veri Sorumlusu</h2>
      <p>
        {info.companyLegalName}
        <br />
        Adres: {info.address}
        <br />
        E-posta: <a href={`mailto:${info.supportEmail}`}>{info.supportEmail}</a>
        <br />
        KEP: <a href={`mailto:${info.kvkkEmail}`}>{info.kvkkEmail}</a>
      </p>

      <h2>2. Çerez Nedir?</h2>
      <p>
        Çerezler, internet sitesini ziyaret ettiğinizde tarayıcınız veya cihazınız üzerinde saklanabilen küçük veri
        dosyalarıdır.
      </p>
      <p>
        Benzer amaçlarla local storage, session storage ve benzeri tarayıcı teknolojileri de kullanılabilir.
      </p>

      <h2>3. Hanuja Hangi Çerezleri Kullanır?</h2>
      <p>
        Hanuja, internet sitesinin güvenli ve düzgün biçimde çalışması, kullanıcı oturumlarının yönetilmesi, kimlik
        doğrulama, güvenlik kontrollerinin gerçekleştirilmesi ve kullanıcı tarafından talep edilen temel site
        işlevlerinin yerine getirilmesi için zorunlu çerezler kullanabilir.
      </p>
      <p>
        Kesinlikle gerekli olan bu çerezler, ilgili işlevin niteliğine göre 6698 sayılı Kişisel Verilerin Korunması
        Kanununda düzenlenen açık rıza dışındaki uygun kişisel veri işleme şartlarına dayanılarak kullanılır.
      </p>
      <p>
        Her çerezin adı, sağlayıcısı, kullanım amacı, süresi, kategorisi ve hukuki sebebi aşağıdaki çerez
        envanterinde ayrı ayrı gösterilir.
      </p>

      <h3>Kullanılan Çerezler</h3>
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="min-w-[960px] border-collapse text-left text-xs leading-relaxed">
          <thead className="bg-muted">
            <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:align-bottom [&>th]:font-semibold">
              <th scope="col">Çerez / Depolama Anahtarı</th>
              <th scope="col">Sağlayıcı</th>
              <th scope="col">Alan Adı</th>
              <th scope="col">Amaç</th>
              <th scope="col">Kategori</th>
              <th scope="col">Birinci / Üçüncü Taraf</th>
              <th scope="col">Süre</th>
              <th scope="col">Hukuki Sebep</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((entry) => (
              <tr
                key={entry.key}
                className="border-t border-border [&>td]:px-3 [&>td]:py-2 [&>td]:align-top first:border-t-0"
              >
                <td>
                  <code className="font-mono font-semibold">{entry.key}</code>
                  <br />
                  <span>{STORAGE_LABELS[entry.storage]}</span>
                </td>
                <td>{entry.provider}</td>
                <td>{entry.domain}</td>
                <td>{entry.purpose}</td>
                <td>{COOKIE_CATEGORY_LABELS[entry.category].tableLabel}</td>
                <td>{entry.party === 'first' ? 'Birinci taraf' : 'Üçüncü taraf'}</td>
                <td>{entry.duration}</td>
                <td>{entry.legalBasis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Bu tablo, internet sitesinde fiilen kullanılan teknolojilerin teknik envanteri esas alınarak güncel tutulur.
        Kullanılmayan veya tahmini çerez adları tabloya eklenmez.
      </p>

      <h2>4. Analitik ve Pazarlama Çerezleri</h2>
      <p>
        Hanuja&apos;nın mevcut teknik yapısında analitik veya reklam/pazarlama amacıyla kullanılan zorunlu olmayan
        çerez bulunmadığı sürece bu amaçlarla kullanıcıdan açık rıza talep edilmez.
      </p>
      <p>
        İleride analitik, kişiselleştirme veya reklam/pazarlama amaçlı ve açık rıza gerektiren bir teknoloji
        kullanılmaya başlanması halinde bu teknoloji, kullanıcı gerekli tercihi yapmadan etkinleştirilmez.
      </p>
      <p>
        Bu durumda kullanıcıya zorunlu olmayan çerezleri kabul etme, reddetme ve kategori bazında tercihlerini
        belirleme imkânı sunulur.
      </p>

      <h2>5. Çerez Tercihlerinin Yönetilmesi</h2>
      <p>
        Zorunlu çerezler, internet sitesinin güvenliği ve temel işlevlerinin sağlanması için gerekli olduklarından
        kapatılamayabilir.
      </p>
      <p>
        Açık rızaya dayanan zorunlu olmayan çerezler kullanılması halinde kullanıcı verdiği tercihi istediği zaman{' '}
        <CookiePreferencesButton className="font-semibold underline underline-offset-2">
          Çerez Tercihleri
        </CookiePreferencesButton>{' '}
        bağlantısı üzerinden değiştirebilir veya geri alabilir.
      </p>
      <p>
        Rızanın geri alınması, geri alma işleminden önce gerçekleştirilen işlemlerin hukuka uygunluğunu etkilemez.
      </p>

      <h2>6. Üçüncü Taraf Hizmetler</h2>
      <p>
        Hanuja&apos;nın güvenlik, kimlik doğrulama, ödeme ve benzeri işlevlerinde üçüncü taraf hizmet
        sağlayıcılardan yararlanılması mümkündür.
      </p>
      <p>
        Üçüncü taraf bir hizmetin çerez veya benzeri teknoloji kullanması halinde bu kullanım teknik olarak tespit
        edilir ve yukarıdaki envanterde sağlayıcı, amaç, süre, kategori ve gerekli hukuki bilgiyle birlikte
        gösterilir.
      </p>

      <h2>7. Yurt Dışına Veri Aktarımı</h2>
      <p>
        Bir çerez veya benzeri teknoloji aracılığıyla kişisel verilerin yurt dışına aktarılması söz konusu olduğunda
        aktarım, 6698 sayılı Kanunun 9 uncu maddesinde düzenlenen şartlardan uygun olanı sağlanarak gerçekleştirilir.
      </p>
      <p>
        Yurt dışı aktarımı doğuran somut hizmet, alıcı grubu ve uygulanabilir aktarım mekanizması ilgili veri işleme
        ve aktarım envanterinde ayrıca değerlendirilir.
      </p>

      <h2>8. İlgili Kişinin Hakları</h2>
      <p>
        Kişisel verilerinizin işlenmesine ilişkin olarak 6698 sayılı Kanunun 11 inci maddesi kapsamındaki haklarınızı
        kullanabilirsiniz.
      </p>
      <p>Başvurularınızı:</p>
      <p>
        <strong>
          <a href={`mailto:${info.supportEmail}`}>{info.supportEmail}</a>
        </strong>
      </p>
      <p>
        adresinden veya mevzuatta öngörülen diğer başvuru yöntemlerinden biriyle Hanuja&apos;ya iletebilirsiniz.
      </p>

      <p className="text-xs">Metin sürümü: {COOKIE_POLICY_VERSION}</p>
    </>
  )
}
