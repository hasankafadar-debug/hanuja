# Scraped Product Excel Store Import Playbook

Follow this playbook whenever a user provides a scraped product Excel file and asks for its products to be loaded into a named store. This document is scoped to controlled, one-off store imports and does not replace repository, security, legal, or production-runbook instructions.

## Agent roles

- Codex Sol (`gpt-5.6-sol`, medium) is used only for new architecture or complex security implementation plans.
- Codex Terra (`gpt-5.6-terra`, low or medium) writes CLI code, tests, and runs routine operations.
- Luna is an external research model used only for new source behavior, legal/robots questions, or external-format research. If no Luna tool/model is available, the main agent performs that research and explicitly states the substitution.
- A routine no-code import uses the main agent or a single Terra agent. Do not open Sol or Luna subtasks for it.

## CLI workflow and low-usage mode

- Use `pnpm catalog-import discover`, `normalize`, `dry-run`, `apply`, and `verify` from `tools/catalog-import`; never recreate a general-purpose UI/API/import service.
- `discover` and `normalize` are local-only. They must never load Prisma, R2, or environment-throwing modules. Source Excel files are never modified.
- Use profile-only changes for new source layouts and run targeted catalog-import tests. Mapping ambiguity, missing required fields, ambiguous categories, invalid stock/model codes, or true variants are blocking and require user direction.
- In low-usage mode, keep stdout to counters plus audit/manifest paths. Keep row, URL, error, and media detail in `.tmp` JSON files. Run no repo-wide build or deployment for this operational CLI; there is no app deployment.
- Always dry-run before apply. Apply requires an unexpired manifest, unchanged normalized hash, exact active store recheck, and `--confirm-store <slug>`. Verify uses DB/R2 checks plus at most three CDN HEAD samples; it never mass-redownloads images.

## Production terminal access

- Prefer PowerShell/SSH and compact command output over browser automation for production inspection and catalog-import operations.
- The Windows SSH identity is local-only at `C:\Users\Hasan\.ssh\hanuja_prod_ed25519`. Never read, print, copy, edit, upload, or commit the private key or its contents.
- Open an interactive VDS shell with:
  `ssh -o IdentitiesOnly=yes -i "C:\Users\Hasan\.ssh\hanuja_prod_ed25519" -p 22666 root@77.245.158.7`
- For a non-interactive connectivity check or a bounded remote command, add `-o BatchMode=yes -o ConnectTimeout=10` and pass only the explicitly required command. Do not print the remote environment or secrets.
- The existing command below opens only a local port tunnel; `-N` deliberately prevents a shell:
  `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 18000:127.0.0.1:8000 -o IdentitiesOnly=yes -i "C:\Users\Hasan\.ssh\hanuja_prod_ed25519" -p 22666 root@77.245.158.7`
- That tunnel exposes the VDS service on remote port `8000` at local `127.0.0.1:18000`. It is not a PostgreSQL or R2 connection and is not sufficient by itself for catalog import.
- Before running an import on the VDS, locate the deployed repository/container and its approved runtime configuration with read-only checks. Do not guess paths, expose environment values, copy production secrets to the repository, or bypass `dry-run → apply → verify`.
- Routine Excel imports do not require a Coolify deployment. Use SSH/terminal for the operation; use browser automation only when a terminal/API check cannot verify a necessary user-facing result.

## Default decisions

- Inspect the source workbook without modifying it. Deliver a cleaned workbook only when the user explicitly asks for one.
- Resolve the target store by its exact production slug or display name. Continue only when exactly one active designer account is found.
- Read canonical categories and attribute options from production before mapping rows. Stop before applying changes if a category mapping is missing or ambiguous.
- Convert the textual stock value `Stokta` to quantity `10`. Preserve valid numeric stock, source price, and fulfillment days.
- Let the existing system generate a unique 13-digit barcode when a barcode is blank.
- Treat a match on seller, category, and normalized model code as an existing product: skip it completely, including its images. Do not update existing products.
- Use the normal product moderation/catalog flow; never force a publication status.
- Treat each scraped row as one variantless product and ignore scraper variant columns unless the user explicitly requests true variant import.
- Import main color, secondary color, and main material when present. Do not infer missing color or material. A secondary color is valid only when a different main color is present.
- Images, colors, and materials are optional. Preserve absent values as empty.
- Download external images, detect their real MIME type (including WebP), upload them to R2, and create seller-owned `MediaAsset` and ordered `ProductImage` records. The first successful image is primary. Never leave an external image URL on a product.
- If an image download or upload fails, continue with the product and its other images. Report the failed URL and reason.
- Do not add a permanent customer, seller, or admin import UI or a generic public import service. Use a temporary, controlled, repeatable operation.
- Run a dry-run before apply. The dry-run and final report must include read, created, skipped-existing, failed-product, successful-image, and failed-image counts.

## Questions and safety gates

Do not re-ask for the defaults above. Ask the user only when one of these cannot be resolved safely: target store is missing, inactive, or non-unique; category is missing or ambiguous; stock is invalid; model codes prevent conflict handling; the data represents true variants; or the user requests a destructive update.

Do not begin an apply operation until the target seller and every category mapping are unambiguous. Never commit source spreadsheets, temporary import data, generated artifacts, credentials, or secrets to the repository.

## Mosaiss baseline

For the Hipicon Mosaiss workbook, use these already-approved decisions:

- Import 92 rows as single, variantless products.
- Keep the five missing main-material values blank.
- Preserve main color/material data; ignore scraper variant color, material, size, and custom variant columns.
- Map products to the canonical production leaves for Orta Sehpa, Yan Sehpa, Dresuar, Kitaplık, Vitrin & Büfe, and Ayna. Stop if any leaf cannot be resolved.
- Process the 258 source images through R2 and Mosaiss's media library, reporting individual failures without retaining Hipicon URLs.
