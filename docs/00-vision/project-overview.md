# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Project Overview

Hanuja, Turkiye pazarina odaklanan, ev, ofis, dekor ve yasam urunleri icin kurgulanmis cok saticili bir marketplace reposudur.
Bu repo; storefront, seller panel, admin panel, backend servisleri ve paylasilan paketleri tek monorepo icinde toplar.

## Hanuja nedir

- Musteriye curated bir urun kesif ve satin alma deneyimi sunar.
- Saticiya katalog, siparis, payout ve operasyon gorunurlugu verir.
- Admin'e odeme, risk, ceza, payout, iade ve moderasyon kontrolleri saglar.

## Temel is modeli

- Musteri odemeyi Hanuja uzerinden yapar.
- Satici yalnizca odemesi onayli siparislere erisir.
- Payout, `delivery_confirmed` sonrasinda 30 gunluk hold tamamlandiginda degerlendirilir.
- Komisyon, reklam veya servis ucretleri, cargo charge, penalty ve refund offset seller net odemesini etkiler.

## Ana kullanici gruplari

| Rol | Ana kullanim alani |
|-----|--------------------|
| Customer | storefront, checkout, account, order tracking, return |
| Seller | seller panel, katalog ve fulfilment islemleri |
| Admin | admin panel, finans ve operasyon denetimi |

## Uygulama yuzeyleri

- `apps/web`: public storefront ve authenticated musteri akislari
- `apps/seller-panel`: satici operasyon paneli
- `apps/admin-panel`: admin operasyon paneli
- `api/`: route, service, domain, repository ve job katmanlari
- `packages/`: UI, SEO, security, types ve ortak config
- `db/`: Prisma schema, migrations ve seed

## Teknik yon

- Next.js App Router tabanli cok uygulamali mimari
- TypeScript, PostgreSQL, Prisma ve Better Auth
- BullMQ + Redis ile asenkron isler
- Meilisearch ile read projection tabanli arama
- Cloudflare R2 ile medya depolama
- Coolify odakli deploy varsayimi

## Mimari ilkeler

- PostgreSQL source of truth'tur.
- Meilisearch yalnizca arama veya read modeli olarak kullanilir.
- Finansal kararlar tarayiciya birakilmaz; backend servisleri ve domain kurallariyla korunur.
- State transition, audit log ve idempotency kritik alanlarda acik ve izlenebilir olmak zorundadir.

## Repo oncelikleri

1. platform dogrulugu
2. finansal dogruluk
3. guvenlik ve hukuki emniyet
4. operasyonel aciklik
5. SEO stabilitesi
6. UX kalitesi

## Kaynak dokuman zinciri

- Ana is gercekleri: `CLAUDE.md`
- Genel scope: `.claude/rules/00-project-scope.md`
- Finans: `.claude/rules/07-marketplace-finance-rules.md`
- Siparis yasam dongusu: `.claude/rules/08-order-lifecycle-rules.md`
- SEO ve route: `.claude/rules/04-seo-rules.md`
- Guvenlik: `.claude/rules/05-security-rules.md`

## Dokumantasyon ilkesi

- Dokumanlar, kodu tekrar anlatan uzun essay degil, karar verdiren repo referanslari olmalidir.
- Hidden policy uydurulmaz; net olmayan alanlar varsayim olarak isaretlenir.
- Kod ve dokuman celisirse source-of-truth siralamasina gore duzeltilir.
