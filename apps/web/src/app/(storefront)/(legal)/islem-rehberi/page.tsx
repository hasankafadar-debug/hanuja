import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'İşlem Rehberi', description: 'Hanuja sipariş, sözleşme ve erişim rehberi.' }

export default function TransactionGuidePage() {
  return <article className="prose mx-auto max-w-3xl px-4 py-12">
    <h1>İşlem Rehberi</h1>
    <h2>Sipariş nasıl kurulur?</h2>
    <ol><li>Ürünü ve varsa varyantını seçip sepete ekleyin.</li><li>Teslimat ve gerekirse farklı fatura adresini seçin.</li><li>Siparişe özel ön bilgilendirme formu ile mesafeli satış sözleşmesini açıp ayrı ayrı onaylayın.</li><li>Kartta “Siparişi Onayla ve Öde” düğmesiyle ödeme yükümlülüğü doğuran siparişi gönderin; EFT’de verilen hesap ve açıklama bilgilerini kullanın.</li></ol>
    <h2>Hatalar nasıl düzeltilir?</h2><p>Ödeme düğmesine basmadan önce sepet, adet, adres ve ödeme yöntemini değiştirebilirsiniz. Bu bilgiler değiştiğinde sözleşme önizlemesi yenilenir ve yeniden onay gerekir.</p>
    <h2>Sözleşmelere erişim</h2><p>Siparişe ait ön bilgilendirme formu ve mesafeli satış sözleşmesi, sipariş detayındaki “Belgeler” alanından indirilebilir. Kayıtlar yasal saklama matrisi uyarınca teknik olarak 10 yıl saklanır; mevzuat veya yetkili danışman görüşü daha uzun süre gerektirirse o süre uygulanır.</p>
    <h2>İptal, iade ve destek</h2><p>Sipariş detayından destek talebi açabilir; uygun durumdaki siparişlerde iade veya cayma akışını başlatabilirsiniz. Ayrıntılar <a href="/iade-iptal">İade & İptal</a> sayfasındadır.</p>
  </article>
}
