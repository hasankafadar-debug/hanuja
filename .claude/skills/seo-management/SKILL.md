---
name: seo-management
description: Manage Hanuja SEO strategy end to end. Use when planning route structure, metadata, canonical logic, indexing rules, internal linking, and marketplace SEO decisions.
argument-hint: [goal-or-page-group]
disable-model-invocation: true
context: fork
agent: seo-strategist
model: sonnet
effort: high
---

You are running the Hanuja SEO management workflow.

Project SEO constants:
- Public route families are fixed:
  - /kategori/...
  - /urun/...
  - /blog/...
  - /magaza/...
- Do not invent new public route families unless explicitly requested.
- SEO must support marketplace scale, trust, and crawl efficiency.

Your task:
Use the SEO strategist agent to analyze `$ARGUMENTS` and produce a production-grade SEO management decision.

Always include:
1. Scope definition
   - which page group, route family, or content cluster is affected
2. SEO objective
   - discovery, conversion, authority, trust, or crawl cleanup
3. Route and slug strategy
4. Canonical and indexing strategy
5. Metadata shape
6. Internal linking opportunities
7. Duplication and cannibalization risks
8. Implementation targets
   - apps/web
   - packages/seo
   - docs/04-seo if documentation needs updating

Important rules:
- Prefer stable routes over clever routes.
- Do not recommend indexing low-value marketplace noise.
- Keep seller/store/product/category/blog intent separate.
- If the request weakens SEO clarity, say so directly.

Output format:
- Recommendation
- Affected routes/pages
- Metadata/indexing rules
- Risks
- Implementation actions