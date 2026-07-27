# Repository Workflow

- Before handling a scraped product spreadsheet or importing its products into a store, read and follow `codex.md` in the repository root.

- For tasks that modify repository files, finish the relevant checks, commit only the files that belong to the task, push the current branch, deploy the affected Coolify service or services, and verify the live result before reporting completion.
- Do not commit, push, or deploy for read-only requests such as investigation, explanation, review, or planning.
- For storefront-only changes, deploy `hanuja-web`. Follow `docs/07-operations/production-deploy-runbook.md` for changes that affect other services, migrations, infrastructure, or production configuration.
- Never include unrelated working-tree changes, generated build metadata, local environment files, credentials, or secrets in a commit.
