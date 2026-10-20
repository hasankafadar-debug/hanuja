import type { Metadata } from 'next'
import { customerLegalHtml } from '@hanuja/api/lib/customer-legal-content'
import LegalDocumentHtml from '@/components/legal-document-html'
import {
  COOKIE_CATEGORY_LABELS,
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
  sessionStorage: 'Sekme depolaması (sessionStorage)',
} as const

export default function CookiePolicyPage() {
  // The published table always shows the real inventory, never the E2E fixture entries.
  const inventory = getBaseCookieInventory()

  return (
    <>
      <LegalDocumentHtml html={customerLegalHtml('04')} />
      <p>
        Kartla ödeme seçildiğinde, gerekli bilgiler ve sözleşme onayı tamamlandıktan sonra
        iyzico’nun kendi alan adındaki güvenli ödeme alanı yüklenir. Kart bilgileri ve bu alandaki
        sağlayıcı teknolojileri iyzico tarafından işlenir. Ayrıntılar için{' '}
        <a
          href="https://www.iyzico.com/gizlilik-politikasi"
          target="_blank"
          rel="noopener noreferrer"
        >
          iyzico aydınlatma metnini
        </a>{' '}
        inceleyebilirsiniz.
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
        Bu tablo, internet sitesinde fiilen kullanılan teknolojilerin teknik envanteri esas alınarak
        güncel tutulur. Kullanılmayan veya tahmini çerez adları tabloya eklenmez.
      </p>

      <p>Mevcut envanterde zorunlu olmayan analitik veya pazarlama çerezi bulunmamaktadır.</p>
      <CookiePreferencesButton className="font-semibold underline underline-offset-2">
        Çerez Tercihleri
      </CookiePreferencesButton>
      <p className="text-xs">Metin sürümü: {COOKIE_POLICY_VERSION}</p>
    </>
  )
}
