import type { Metadata } from 'next'
import Link from 'next/link'
import { PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'

export const metadata: Metadata = {
  title: 'KVKK Aydınlatma Metni',
  description: 'Hanuja kişisel verilerin korunması kanunu kapsamında aydınlatma metni.',
  robots: { index: true, follow: true },
}

const KVKK_NOTICE_UPDATED_AT = '28.09.2026'

export default function KvkkPage() {
  const info = PLATFORM_LEGAL_INFO

  return (
    <>
      <h1>KVKK Aydınlatma Metni</h1>
      <p>
        <strong>Son Güncelleme: {KVKK_NOTICE_UPDATED_AT}</strong>
      </p>
      <p>
        6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) kapsamında, kişisel verileriniz veri sorumlusu
        sıfatıyla <strong>{info.companyLegalName}</strong> (“Hanuja”) tarafından aşağıda açıklanan kapsamda
        işlenmektedir.
      </p>

      <h2>1. Veri Sorumlusu / Platform İşletmecisi</h2>
      <p>
        <strong>Unvan:</strong> {info.companyLegalName}
        <br />
        <strong>Adres:</strong> {info.address}
        <br />
        <strong>Vergi Dairesi / No:</strong> {info.taxOffice} / {info.taxNumber}
        <br />
        <strong>MERSİS No:</strong> {info.mersis}
        <br />
        <strong>KEP:</strong> <a href={`mailto:${info.kvkkEmail}`}>{info.kvkkEmail}</a>
        <br />
        <strong>E-posta:</strong> <a href={`mailto:${info.supportEmail}`}>{info.supportEmail}</a>
        <br />
        <strong>Telefon:</strong> <a href={info.phoneHref}>{info.phoneDisplay}</a>
      </p>
      <p>
        Hanuja, farklı satıcıların ürünlerini tüketicilere sunduğu elektronik ticaret pazaryeri ve elektronik ticaret
        aracı hizmet sağlayıcıdır. Ürün satışının tarafı, ilgili ürün veya sipariş ekranında belirtilen satıcıdır.
      </p>

      <h2>2. İşlenen Kişisel Veri Kategorileri</h2>
      <p>Hanuja tarafından hizmetin niteliğine göre aşağıdaki kişisel veri kategorileri işlenebilir:</p>
      <ul>
        <li>
          <strong>Kimlik bilgileri:</strong> ad, soyad ve hesap sahibiyle ilişkilendirilen diğer kimlik bilgileri,
        </li>
        <li>
          <strong>İletişim bilgileri:</strong> e-posta adresi, telefon numarası ve teslimat/fatura adresleri,
        </li>
        <li>
          <strong>Müşteri işlem bilgileri:</strong> üyelik, sepet, sipariş, favori, mağaza takip, ürün yorumları,
          iptal ve iade işlem bilgileri,
        </li>
        <li>
          <strong>Sipariş ve teslimat bilgileri:</strong> satın alınan ürünler, sipariş durumu, teslimat adresi,
          teslimat telefonu ve kargo sürecine ilişkin bilgiler,
        </li>
        <li>
          <strong>Ödeme işlem bilgileri:</strong> ödeme yöntemi, işlem tutarı, ödeme durumu ve ödeme kuruluşunca
          oluşturulan işlem/referans bilgileri,
        </li>
        <li>
          <strong>Havale/EFT bilgileri:</strong> ödeme yapan kişi bilgisi, ödeme açıklaması ve gerektiğinde ödeme
          dekontunda yer alan bilgiler,
        </li>
        <li>
          <strong>Müşteri hizmetleri ve uyuşmazlık bilgileri:</strong> destek talepleri, mesajlaşmalar, şikâyetler,
          iade ve uyuşmazlık kayıtları ile sunulan belge ve görseller,
        </li>
        <li>
          <strong>İşlem güvenliği bilgileri:</strong> IP adresi, oturum, cihaz/tarayıcı ve güvenlik kayıtları ile
          sistem işlem logları,
        </li>
        <li>
          <strong>Risk ve işlem güvenliği bilgileri:</strong> dolandırıcılık ve ödeme güvenliği amacıyla oluşturulan
          risk göstergeleri ve risk puanları,
        </li>
        <li>
          <strong>Pazarlama ve iletişim tercihleri:</strong> yalnızca ilgili hukuki şartların sağlandığı durumlarda
          ticari elektronik ileti tercihleri ve izin/ret kayıtları.
        </li>
      </ul>
      <p>
        Hanuja kart numarası, CVV veya kart şifresi gibi ödeme kartı bilgilerini kendi veri tabanında saklamaz. Kartlı
        ödeme işlemleri yetkili ödeme hizmeti sağlayıcısının güvenli altyapısı üzerinden gerçekleştirilir.
      </p>

      <h2>3. Kişisel Verilerin İşlenme Amaçları</h2>
      <p>Kişisel verileriniz;</p>
      <ul>
        <li>üyelik hesabının oluşturulması ve yönetilmesi,</li>
        <li>siparişin kurulması ve sipariş sürecinin yürütülmesi,</li>
        <li>siparişin ilgili satıcı tarafından hazırlanması ve teslimatının sağlanması,</li>
        <li>ödeme işlemlerinin gerçekleştirilmesi ve doğrulanması,</li>
        <li>havale/EFT ödemelerinin siparişlerle eşleştirilmesi,</li>
        <li>iptal, cayma, iade ve satış sonrası süreçlerin yürütülmesi,</li>
        <li>müşteri destek hizmetlerinin sağlanması,</li>
        <li>şikâyet ve uyuşmazlıkların incelenmesi ve çözümlenmesi,</li>
        <li>işlem ve hesap güvenliğinin sağlanması,</li>
        <li>sahtecilik, kötüye kullanım ve dolandırıcılık girişimlerinin tespit edilmesi ve önlenmesi,</li>
        <li>ödeme ve sipariş işlemlerine ilişkin risk kontrollerinin yapılması,</li>
        <li>muhasebe, faturalama ve mali yükümlülüklerin yerine getirilmesi,</li>
        <li>hukuki yükümlülüklerin yerine getirilmesi,</li>
        <li>yetkili kamu kurum ve kuruluşlarından gelen hukuka uygun taleplerin karşılanması,</li>
        <li>hukuki uyuşmazlıklarda hakların tesisi, kullanılması veya korunması</li>
      </ul>
      <p>amaçlarıyla işlenebilir.</p>
      <p>
        Pazarlama ve ticari elektronik ileti faaliyetleri, ilgili mevzuat uyarınca gerekli olması halinde ayrıca
        alınan izin veya uygun diğer hukuki şartlara dayanılarak yürütülür.
      </p>

      <h2>4. Kişisel Verilerin Toplanma Yöntemi</h2>
      <p>Kişisel verileriniz;</p>
      <ul>
        <li>www.hanuja.com.tr internet sitesi,</li>
        <li>üyelik ve giriş ekranları,</li>
        <li>sipariş ve ödeme adımları,</li>
        <li>kullanıcı hesabı ve müşteri paneli,</li>
        <li>destek, iade ve uyuşmazlık formları,</li>
        <li>e-posta ve diğer iletişim kanalları,</li>
        <li>ödeme kuruluşlarından alınan işlem sonuçları,</li>
        <li>havale/EFT işlemleri kapsamında sunulan bilgiler,</li>
        <li>güvenlik ve sistem kayıtları,</li>
        <li>çerezler ve benzeri zorunlu teknik teknolojiler</li>
      </ul>
      <p>aracılığıyla tamamen veya kısmen otomatik yollarla elde edilebilir.</p>
      <p>
        Çerezler ve benzeri teknolojiler aracılığıyla gerçekleştirilen kişisel veri işleme faaliyetleri hakkında
        ayrıca <Link href="/cerez-politikasi">Çerez Aydınlatma Metni</Link> üzerinden bilgi verilir.
      </p>

      <h2>5. Kişisel Verilerin İşlenmesinin Hukuki Sebepleri</h2>
      <p>Kişisel verileriniz, gerçekleştirilen işleme faaliyetine göre KVKK&apos;nın 5 inci maddesinde düzenlenen;</p>
      <ul>
        <li>bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması,</li>
        <li>veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması,</li>
        <li>bir hakkın tesisi, kullanılması veya korunması için veri işlemenin zorunlu olması,</li>
        <li>
          ilgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaatleri için
          veri işlenmesinin zorunlu olması
        </li>
      </ul>
      <p>hukuki sebeplerinden uygun olanına dayanılarak işlenir.</p>
      <p>
        Bir kişisel veri işleme faaliyetinin yukarıdaki veya kanunda düzenlenen diğer açık rıza dışındaki işleme
        şartlarına dayandırılamaması halinde, gerekli olması durumunda ilgili kişiden ayrıca açık rıza alınır.
      </p>
      <p>Aydınlatma yükümlülüğü ile açık rıza alma işlemleri birbirinden ayrı olarak yürütülür.</p>

      <h2>6. Kişisel Verilerin Aktarılması</h2>
      <p>
        Kişisel verileriniz, yalnızca ilgili işlem için gerekli olduğu ölçüde ve ilgili hukuki şartların bulunması
        halinde aşağıdaki alıcı gruplarına aktarılabilir:
      </p>
      <h3>İlgili satıcılar</h3>
      <p>
        Siparişin hazırlanması, faturalandırılması, teslim edilmesi, iade, garanti ve satış sonrası hizmetlerin
        yürütülmesi amacıyla ilgili siparişin satıcısına gerekli müşteri ve teslimat bilgileri aktarılabilir.
      </p>
      <p>Satıcıya, hizmetin yürütülmesi için gerekli olmayan kişisel veriler aktarılmaz.</p>
      <h3>Ödeme hizmeti sağlayıcıları ve finansal kuruluşlar</h3>
      <p>
        Ödeme, iade, tahsilat, ödeme doğrulama ve işlem güvenliği süreçlerinin gerçekleştirilmesi amacıyla gerekli
        işlem bilgileri yetkili ödeme kuruluşları ve bankalarla paylaşılabilir.
      </p>
      <h3>Teknik hizmet sağlayıcılar</h3>
      <p>
        Barındırma, güvenlik, e-posta, kimlik doğrulama, veri yedekleme ve diğer teknik altyapı hizmetlerinin
        sağlanması amacıyla gerekli kişisel veriler, ilgili hizmeti sunan teknik hizmet sağlayıcılarla sınırlı olarak
        paylaşılabilir.
      </p>
      <h3>Yetkili kamu kurum ve kuruluşları</h3>
      <p>
        Kanuni yükümlülüklerin yerine getirilmesi veya usulüne uygun yetkili makam taleplerinin karşılanması amacıyla
        kişisel veriler yetkili kamu kurumları, idari merciler ve yargı makamlarıyla paylaşılabilir.
      </p>
      <p>
        Hanuja&apos;nın mevcut operasyon modelinde kargo firmasıyla doğrudan veri paylaşımının satıcı tarafından
        gerçekleştirilmesi halinde, ilgili kargo aktarımı satıcının kendi kişisel veri işleme faaliyeti kapsamında
        yürütülür.
      </p>

      <h2>7. Kişisel Verilerin Yurt Dışına Aktarılması</h2>
      <p>
        Hanuja&apos;nın bazı teknik altyapı ve hizmet sağlayıcılarının yurt dışında bulunması veya hizmetin yurt
        dışındaki sistemler üzerinden sunulması nedeniyle, ilgili hizmet kapsamında işlenen belirli kişisel verilerin
        yurt dışına aktarılması söz konusu olabilir.
      </p>
      <p>
        Yurt dışına kişisel veri aktarımı, KVKK&apos;nın 9 uncu maddesinde ve ilgili ikincil mevzuatta düzenlenen
        aktarım şartlarından uygun olanının sağlanması suretiyle gerçekleştirilir.
      </p>
      <p>
        Aktarım yapılan hizmet sağlayıcı, aktarılan veri kategorileri ve uygulanan aktarım mekanizması Hanuja&apos;nın
        kişisel veri işleme ve aktarım envanteri kapsamında güncel olarak değerlendirilir.
      </p>

      <h2>8. Otomatik Risk ve Güvenlik Kontrolleri</h2>
      <p>
        Sipariş ve ödeme güvenliğinin sağlanması, sahtecilik ve kötüye kullanım girişimlerinin önlenmesi amacıyla bazı
        işlemler otomatik güvenlik ve risk kontrollerine tabi tutulabilir.
      </p>
      <p>
        Bu kapsamda başarısız ödeme girişimleri, hesap yaşı, işlem tutarı, işlem sıklığı, geçmiş iade veya uyuşmazlık
        kayıtları gibi işlem güvenliğiyle ilişkili göstergeler değerlendirilebilir.
      </p>
      <p>
        Yüksek riskli olarak değerlendirilen işlemler otomatik olarak reddedilmek yerine gerektiğinde ek incelemeye
        alınabilir, ödeme veya sipariş güvenliği amacıyla geçici olarak kontrol edilebilir.
      </p>

      <h2>9. KVKK Kapsamındaki Haklarınız</h2>
      <p>KVKK&apos;nın 11 inci maddesi kapsamında kişisel verilerinizle ilgili olarak;</p>
      <ul>
        <li>kişisel verilerinizin işlenip işlenmediğini öğrenme,</li>
        <li>işlenmişse buna ilişkin bilgi talep etme,</li>
        <li>işleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
        <li>verilerin aktarıldığı üçüncü kişileri öğrenme,</li>
        <li>şartları oluşmuşsa verilerin düzeltilmesini, silinmesini veya yok edilmesini isteme,</li>
        <li>KVKK kapsamında tanınan diğer haklarınızı kullanma</li>
      </ul>
      <p>hakkına sahipsiniz.</p>

      <h2>10. Başvuru</h2>
      <p>KVKK kapsamındaki başvurularınızı kimliğinizi ve talebinizi belirlemeye imkân verecek bilgilerle birlikte;</p>
      <p>
        <strong>KEP:</strong> <a href={`mailto:${info.kvkkEmail}`}>{info.kvkkEmail}</a>
      </p>
      <p>veya</p>
      <p>
        <strong>Yazılı başvuru adresi:</strong>
        <br />
        {info.companyLegalName}
        <br />
        {info.address}
      </p>
      <p>üzerinden mevzuatta öngörülen başvuru usullerine uygun olarak iletebilirsiniz.</p>
      <p>Genel iletişim için:</p>
      <p>
        <strong>E-posta:</strong> <a href={`mailto:${info.supportEmail}`}>{info.supportEmail}</a>
        <br />
        <strong>Telefon:</strong> <a href={info.phoneHref}>{info.phoneDisplay}</a>
      </p>
    </>
  )
}
