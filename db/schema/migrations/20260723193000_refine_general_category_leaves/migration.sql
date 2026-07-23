BEGIN;

-- Normalize the auto-created Hipicon child before adding the canonical launch leaf.
UPDATE "categories"
SET
  "slug" = 'ev-mobilya-sehpa-modelleri-yan-sehpa',
  "name" = 'Yan Sehpa',
  "sortOrder" = 2,
  "createdViaImportBy" = NULL,
  "createdViaImportAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'ev-mobilya-sehpa-modelleri-yan-sehpa-modelleri'
  AND NOT EXISTS (
    SELECT 1 FROM "categories" existing
    WHERE existing."slug" = 'ev-mobilya-sehpa-modelleri-yan-sehpa'
  );

WITH child_categories(id, slug, name, parent_slug, sort_order) AS (
  VALUES
    ('cat_ev_mobilya_dresuar_konsol_dresuar', 'ev-mobilya-dresuar-konsol-dresuar', 'Dresuar', 'ev-mobilya-dresuar-konsol', 1),
    ('cat_ev_mobilya_dresuar_konsol_konsol', 'ev-mobilya-dresuar-konsol-konsol', 'Konsol', 'ev-mobilya-dresuar-konsol', 2),
    ('cat_ev_mobilya_sehpa_orta', 'ev-mobilya-sehpa-modelleri-orta-sehpa', 'Orta Sehpa', 'ev-mobilya-sehpa-modelleri', 1),
    ('cat_ev_mobilya_sehpa_yan', 'ev-mobilya-sehpa-modelleri-yan-sehpa', 'Yan Sehpa', 'ev-mobilya-sehpa-modelleri', 2),
    ('cat_ev_mobilya_sehpa_zigon', 'ev-mobilya-sehpa-modelleri-zigon-sehpa', 'Zigon Sehpa', 'ev-mobilya-sehpa-modelleri', 3),
    ('cat_ev_mobilya_bahce_oturma_grubu', 'ev-mobilya-bahce-mobilyasi-oturma-grubu', 'Bahçe Oturma Grubu', 'ev-mobilya-bahce-mobilyasi', 1),
    ('cat_ev_mobilya_bahce_masa_sandalye', 'ev-mobilya-bahce-mobilyasi-masa-sandalye', 'Bahçe Masa & Sandalye', 'ev-mobilya-bahce-mobilyasi', 2),
    ('cat_ev_mobilya_bahce_dis_mekan_sehpa', 'ev-mobilya-bahce-mobilyasi-dis-mekan-sehpa', 'Dış Mekan Sehpa', 'ev-mobilya-bahce-mobilyasi', 3),
    ('cat_ev_aydinlatma_tavan', 'ev-aydinlatma-tavan-sarkit-tavan-aydinlatma', 'Tavan Aydınlatma', 'ev-aydinlatma-tavan-sarkit', 1),
    ('cat_ev_aydinlatma_sarkit', 'ev-aydinlatma-tavan-sarkit-sarkit', 'Sarkıt Aydınlatma', 'ev-aydinlatma-tavan-sarkit', 2),
    ('cat_ev_mutfak_tabak', 'ev-mutfak-tabak-kase-tabak', 'Tabak', 'ev-mutfak-tabak-kase', 1),
    ('cat_ev_mutfak_kase', 'ev-mutfak-tabak-kase-kase', 'Kase', 'ev-mutfak-tabak-kase', 2),
    ('cat_ev_mutfak_sofra_seti', 'ev-mutfak-tabak-kase-sofra-seti', 'Sofra Seti', 'ev-mutfak-tabak-kase', 3),
    ('cat_ev_dekorasyon_mum', 'ev-dekorasyon-mum-mumluk-mum', 'Mum', 'ev-dekorasyon-mum-mumluk', 1),
    ('cat_ev_dekorasyon_mumluk', 'ev-dekorasyon-mum-mumluk-mumluk', 'Mumluk', 'ev-dekorasyon-mum-mumluk', 2)
)
INSERT INTO "categories" (
  "id",
  "slug",
  "name",
  "parentId",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  child_categories.id,
  child_categories.slug,
  child_categories.name,
  parents.id,
  child_categories.sort_order,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM child_categories
JOIN "categories" parents ON parents."slug" = child_categories.parent_slug
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "parentId" = EXCLUDED."parentId",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = TRUE,
  "createdViaImportBy" = NULL,
  "createdViaImportAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-sehpa-modelleri'
  AND target."slug" = 'ev-mobilya-sehpa-modelleri-orta-sehpa'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%orta-sehpa%' OR p."name" ILIKE '%orta%sehpa%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-sehpa-modelleri'
  AND target."slug" = 'ev-mobilya-sehpa-modelleri-zigon-sehpa'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%zigon-sehpa%' OR p."name" ILIKE '%zigon%sehpa%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" IN (
    'ev-mobilya-sehpa-modelleri',
    'ev-mobilya-sehpa-modelleri-yan-sehpa-modelleri',
    'ev-mobilya-sehpa-modelleri-yan-sehpa'
  )
  AND target."slug" = 'ev-mobilya-sehpa-modelleri-yan-sehpa'
  AND p."categoryId" = source.id
  AND source.id <> target.id
  AND (
    source."slug" = 'ev-mobilya-sehpa-modelleri-yan-sehpa-modelleri'
    OR p."slug" ILIKE '%yan-sehpa%'
    OR p."name" ILIKE '%yan%sehpa%'
    OR p."name" ILIKE '%c sehpa%'
  );

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-dresuar-konsol'
  AND target."slug" = 'ev-mobilya-dresuar-konsol-konsol'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%konsol%' OR p."name" ILIKE '%konsol%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-dresuar-konsol'
  AND target."slug" = 'ev-mobilya-dresuar-konsol-dresuar'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%dresuar%' OR p."name" ILIKE '%dresuar%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-bahce-mobilyasi'
  AND target."slug" = 'ev-mobilya-bahce-mobilyasi-oturma-grubu'
  AND p."categoryId" = source.id
  AND (
    p."slug" ILIKE '%oturma%'
    OR p."name" ILIKE '%oturma%'
    OR p."slug" ILIKE '%koltuk%'
    OR p."name" ILIKE '%koltuk%'
  );

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-bahce-mobilyasi'
  AND target."slug" = 'ev-mobilya-bahce-mobilyasi-masa-sandalye'
  AND p."categoryId" = source.id
  AND (
    p."slug" ILIKE '%masa%'
    OR p."name" ILIKE '%masa%'
    OR p."slug" ILIKE '%sandalye%'
    OR p."name" ILIKE '%sandalye%'
  );

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mobilya-bahce-mobilyasi'
  AND target."slug" = 'ev-mobilya-bahce-mobilyasi-dis-mekan-sehpa'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%sehpa%' OR p."name" ILIKE '%sehpa%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-aydinlatma-tavan-sarkit'
  AND target."slug" = 'ev-aydinlatma-tavan-sarkit-sarkit'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%sarkit%' OR p."name" ILIKE '%sarkıt%' OR p."name" ILIKE '%sarkit%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-aydinlatma-tavan-sarkit'
  AND target."slug" = 'ev-aydinlatma-tavan-sarkit-tavan-aydinlatma'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%tavan%' OR p."name" ILIKE '%tavan%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mutfak-tabak-kase'
  AND target."slug" = 'ev-mutfak-tabak-kase-sofra-seti'
  AND p."categoryId" = source.id
  AND (
    p."slug" ILIKE '%sofra%'
    OR p."name" ILIKE '%sofra%'
    OR p."slug" ILIKE '%takim%'
    OR p."name" ILIKE '%takım%'
    OR p."name" ILIKE '%takim%'
  );

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mutfak-tabak-kase'
  AND target."slug" = 'ev-mutfak-tabak-kase-tabak'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%tabak%' OR p."name" ILIKE '%tabak%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-mutfak-tabak-kase'
  AND target."slug" = 'ev-mutfak-tabak-kase-kase'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%kase%' OR p."name" ILIKE '%kase%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-dekorasyon-mum-mumluk'
  AND target."slug" = 'ev-dekorasyon-mum-mumluk-mumluk'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%mumluk%' OR p."name" ILIKE '%mumluk%');

UPDATE "products" p
SET "categoryId" = target.id
FROM "categories" source, "categories" target
WHERE source."slug" = 'ev-dekorasyon-mum-mumluk'
  AND target."slug" = 'ev-dekorasyon-mum-mumluk-mum'
  AND p."categoryId" = source.id
  AND (p."slug" ILIKE '%mum%' OR p."name" ILIKE '%mum%');

DELETE FROM "categories" old_child
WHERE old_child."slug" = 'ev-mobilya-sehpa-modelleri-yan-sehpa-modelleri'
  AND NOT EXISTS (
    SELECT 1 FROM "products" p
    WHERE p."categoryId" = old_child.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM "categories" child
    WHERE child."parentId" = old_child.id
  );

COMMIT;
