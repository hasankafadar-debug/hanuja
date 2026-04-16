# Production Readiness — Mevcut Durum ve Plan

## Durum Özeti (2025-04 itibarıyla)

Backend katmanı %80 hazır. Frontend sayfaları backend'i çağırmıyor — hardcoded mock data gösteriyor.

### Çalışan katmanlar
- Prisma schema: 24 enum, 30+ model
- Auth: Better Auth + email/password + session + role middleware
- API routes: 16 dosya, 90+ handler, Zod validation
- Service katmanı: cart, checkout, payment, order, payout, penalty, return, dispute, blog, coupon, seller, user, search, media
- Repository katmanı: 18 repository, gerçek Prisma query'leri
- Security: rate limiting, CSRF, webhook verification, fraud scoring, audit logging
- Test: 477 test (unit + integration + security)

### Çalışmayan kritik alan: Frontend → Backend bağlantısı

| Sayfa | Backend çağırıyor mu? |
|-------|----------------------|
| Ana sayfa | ❌ Hardcoded ürünler |
| Ürün detay (`/urun/[slug]`) | ❌ Slug'dan fake data |
| Kategori (`/kategori/[...slug]`) | ❌ 8 hardcoded ürün |
| Sepet (`/sepet`) | ✅ Çalışıyor |
| Ödeme (`/odeme`) | ✅ Çalışıyor (Iyzico hariç) |
| Siparişlerim | ❌ Mock data |
| Arama (`/arama`) | ❌ Placeholder |
| Giriş/Kayıt | ✅ Çalışıyor |
| Seller panel (6/7) | ❌ Mock data (sadece kargolar çalışıyor) |
| Admin panel (4/4) | ❌ Mock data |

## Yapılacaklar — Öncelik sırası

### 1. D1 + D2: Migration + Seed data
- Initial Prisma migration oluştur
- Test ürünleri, kategoriler, satıcılar seed et
- Docker compose ile DB çalıştır

### 2. Faz A: Storefront → backend bağlantısı
- A1: Ürün detay → `catalog.ts/getProductBySlug()` + "Sepete Ekle" handler
- A2: Kategori → `catalog.ts/listProducts()` + filtreleme/pagination
- A3: Ana sayfa → Backend'den öne çıkan ürünler
- A4: Arama → Meilisearch API
- A5: Siparişlerim → `orders.ts/listCustomerOrders()`

### 3. Faz B: Seller panel → backend bağlantısı
- Siparişler, ödemeler, ürün yönetimi

### 4. Faz C: Admin panel → backend bağlantısı
- Ödemeler, hakedişler, cezalar, finans dashboard

### 5. D3: Ödeme entegrasyonu

## Kural

Bu dosya production readiness durumunu yansıtır.
Frontend sayfaları backend'e bağlandıkça yukarıdaki tabloyu güncelle.
Yeni sayfa eklerken mutlaka gerçek backend entegrasyonu yap — hardcoded mock data YASAK.
