# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Metadata Rules

Bu belge, Hanuja storefront icin title, description, OG ve canonical metadata mantigini sabitler.
Kaynaklar: `.claude/rules/04-seo-rules.md`, `packages/seo/src/metadata-builder.ts`, `packages/seo/src/canonical-builder.ts`.

## Temel ilke

- Metadata entity'ye ozel, deterministic ve server-side olmalidir.
- Ayni kaynak icin birden fazla competing title veya description uretilmez.
- Metadata, sayfadaki gorunen icerikle celismemelidir.

## Title kaliplari

| Sayfa tipi | Kalip |
|------------|-------|
| Ana sayfa | `Hanuja - Ev, Ofis ve Yasam Urunleri` |
| Kategori | `{{CategoryName}} | Hanuja` |
| Urun | `{{ProductName}} | Hanuja` |
| Store | `{{StoreName}} Magazasi | Hanuja` |
| Blog detay | `{{ArticleTitle}} | Hanuja Blog` |
| Blog liste | `Blog ve Ilham | Hanuja` |

## Description kurallari

- 140 ile 160 karakter bandi hedeflenir.
- Varsayilan description yedegi olsa bile entity'ye ozgu metin tercih edilir.
- Keyword stuffing yapilmaz; tek cümlede birden cok arama niyeti zorla yigılmaz.
- Kategori ve store sayfalarinda description, kullaniciya ne bulacagini net anlatmalidir.

## Fallback zinciri

- Urun: entity description -> kisa seller onayi gecmis ozet -> guvenli site varsayimi
- Kategori: kategori metni -> kategori etiketi tabanli varsayim
- Store: seller tanitimi -> standard store fallback
- Blog: excerpt -> giris paragrafi -> genel blog fallback

## Open Graph ve social

- OG title ve description, HTML metadata ile ayni anlam hattinda kalir.
- OG image varsa entity ile uyumlu gorsel kullanilir; yoksa kaliteli varsayilan gorsel kullanilabilir.
- Twitter card `summary_large_image` tercih edilir.
- Social metadata, canonical ile ayni public URL'yi isaret etmelidir.

## Canonical baglantisi

- Metadata builder'lar `alternates.canonical` alanini her public sayfada set etmelidir.
- Category, product, store ve blog sayfalarinda route helper disinda el ile canonical uretilmez.
- Redirect durumunda eski slug aktif metadata uretmemeli, yeni canonical'a tasinmalidir.

## Dil ve yazi kurallari

- Ana dil Turkcedir.
- Title'larda gereksiz sembol, emoji veya slogan tekrarina yer verilmez.
- Marka eki her title'da sonda ve tek kez yer alir.

## Uygulama etkileri

- `packages/seo/src/metadata-builder.ts` icindeki kaliplar bu belgeye gore korunur veya revize edilir.
- Public legal sayfalar da kisa ama acik metadata almalıdır; bos title ile yayin yapilmaz.
- Metadata degisiklikleri `docs/04-seo/technical-seo-spec.md` ve canonical kararlar ile birlikte dusunulmelidir.
