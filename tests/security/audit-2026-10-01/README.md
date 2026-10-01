# Yerel denetimi tekrar çalıştırma

Çalışma kökü `H:\Claude marketplace`. Mevcut kurulu bağımlılıklar kullanılır; install, `pnpm audit`, push/deploy veya gerçek backup/restore çalıştırılmaz. [Rapor](rapor.md) ve [tehdit modeli](hanuja-threat-model.md) sonuçları açıklar.

PowerShell'de test/lint/typecheck öncesi:

```powershell
$env:NEXT_TELEMETRY_DISABLED='1'
$env:TURBO_TELEMETRY_DISABLED='1'
$env:DO_NOT_TRACK='1'
$env:NODE_OPTIONS='--require="H:/Claude marketplace/tests/security/audit-2026-10-01/network-guard.cjs"'
pnpm --filter @hanuja/tests test:security
pnpm --filter @hanuja/tests test
pnpm --filter web --filter seller-panel --filter admin-panel --filter @hanuja/api --filter @hanuja/security --filter @hanuja/seo typecheck
pnpm --filter web --filter seller-panel --filter admin-panel --filter @hanuja/security --filter @hanuja/seo lint
node tests/security/audit-2026-10-01/verify-network-guard.cjs
node tests/security/audit-2026-10-01/inventory.mjs
```

Windows Git Bash komutları yalnız stub testi ve syntax kontrolüdür:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -n tools/ops/restore-drill.sh
& 'C:\Program Files\Git\bin\bash.exe' --noprofile --norc -c 'export PATH=/usr/bin:/bin:$PATH; bash tests/security/audit-2026-10-01/restore-drill-stubs.sh'
```

Linux/macOS'ta `bash tests/security/audit-2026-10-01/restore-drill-stubs.sh` yeterlidir. Stub harness yalnız kendi geçici config, dosya ve komutlarını kullanır; sonunda doğrulanmış geçici dizini temizler. Gerçek `tools/ops/restore-drill.sh` normal ops ortamında remote backup ve DB'ye ulaşır; yerel denetim komutu olarak doğrudan çalıştırmayın.

Build kontrolünde aynı Node guard ile DB/Redis/search loopback `127.0.0.1:9`, auth secret/public origin ve sağlayıcı ayarları sentetik değerlerle override edildi. Üç app sırayla `pnpm -r --workspace-concurrency=1 --filter web --filter seller-panel --filter admin-panel build` ile derlendi. Ortam dosyalarını guard/override olmadan kullanıp production bağlantısı açmak bu yerel denetimin kapsamı değildir. Native binary'ler Node guard'ın dışında kalır; PostgreSQL/provider/restore testlerinin atlanma nedeni budur.

Kanıt JSON'ları temizlenmiş sonuçları tutar; raw test stderr, runtime credentials veya gerçek müşteri kaydı içermez. Inventory dar regex adaylarını listeler, secretsiz/güvenli sertifikası değildir. `tests/postgres` ve browser E2E varsayılan test çalıştırmasına dahil değildir.

Repo post-commit hook'u otomatik push içerir. Bu görevde yalnız yerel commit istendiğinden commit komutları `git -c core.hooksPath=.git/offline-disabled-hooks commit ...` ile kullanıldı; global/repo hook ayarı değiştirilmedi.
