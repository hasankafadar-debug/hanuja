# Hanuja Prompt Patterns

Bu dosya, Hanuja projesinde Claude ile çalışırken kullanılacak standart prompt kalıplarını içerir.

Amaç:
- daha tutarlı çıktı almak
- doğru agent ve skill kullanımını hızlandırmak
- kural odaklı çalışma düzenini korumak

---

## 1. Genel prompt yazım ilkeleri

İyi Hanuja prompt’u şu 4 şeyi açık söyler:

1. Hangi yüzey?
   - storefront
   - seller panel
   - admin panel
   - backend
   - SEO
   - docs

2. Hangi iş kuralı etkileniyor?

3. Ne istiyorum?
   - plan
   - implementasyon
   - review
   - test checklist
   - copy/SEO düzeni
   - security kontrolü

4. Çıktı formatı ne olsun?
   - dosya bazlı
   - adım adım
   - karar + risk
   - checklist
   - kodsuz plan
   - production-ready içerik

---

## 2. Mimari karar prompt’ları

### Mimari plan isteme
```text
Use the marketplace-architect agent.
Hanuja için [özellik/değişiklik] planı çıkar.
Etkilenen klasörleri, korunması gereken invariant’ları, riskleri ve uygulama sırasını ver.
Kod yazma.