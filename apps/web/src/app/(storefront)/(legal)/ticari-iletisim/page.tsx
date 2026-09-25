import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export default function CommercialCommunicationPage() {
  return <article className="mx-auto max-w-3xl space-y-5 px-4 py-12">
    <h1 className="text-3xl font-semibold">Ticari iletişim bilgilendirmesi</h1>
    <p>Hanuja markasının hizmet sağlayıcısı {PLATFORM_LEGAL_INFO.companyNameDisplay} tarafından reklam, indirim ve promosyon bilgileri e-posta ve SMS kanallarıyla iletilebilir. İzin isteğe bağlıdır; üyeliğin veya siparişin koşulu değildir.</p>
    <p>Üyelik ekranındaki tek tercih her iki kanalı kapsar. Kanal ve iletişim adresi bazında kayıt tutulur. Telefon bulunmaması halinde SMS adres izni oluşmaz. Sonradan eklenen veya değiştirilen adres için önceki izin geçerli olmaz.</p>
    <p>Hesabım → İletişim Tercihleri alanından e-posta ve SMS izinlerini ayrı ayrı geri çekebilirsiniz. Reklam e-postalarının altındaki abonelikten çıkış bağlantısını giriş yapmadan da kullanabilirsiniz. Ret işlemi ücretsizdir; sipariş, güvenlik ve diğer işlemsel bildirimler devam eder.</p>
    <p>İYS hazırlığı tamamlanana kadar yeni izin alınmaz ve reklam gönderilmez. Mevcut kayıtlara ilişkin ret hakkınız devam eder.</p>
    <p>MERSİS: {PLATFORM_LEGAL_INFO.mersis}<br />{PLATFORM_LEGAL_INFO.address}<br />{PLATFORM_LEGAL_INFO.supportEmail}</p>
    <p className="text-sm text-neutral-500">Metin sürümü: marketing-v1</p>
  </article>
}
