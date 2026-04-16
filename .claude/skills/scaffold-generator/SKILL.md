---
name: scaffold-generator
description: Use when creating a new domain module, API route, page, or component scaffold for Hanuja. Generates consistent file structure following architecture rules.
user-invocable: true
paths:
  - "api/**/*"
  - "apps/**/*"
  - "packages/**/*"
  - "tools/generators/**/*"
model: sonnet
effort: medium
---

This skill defines Hanuja scaffold generation discipline.

Main principle:
New modules must follow the established layer separation and naming conventions. Scaffold creates the skeleton — business logic must be filled in explicitly.

Domain module scaffold (api layer):
When creating a new domain module (e.g., "coupon"):
```
api/
  domain/
    coupon/
      coupon.types.ts       — TypeScript interfaces and enums
      coupon.validator.ts   — Input validation schemas (zod)
      coupon.calculator.ts  — Pure business logic functions
  repositories/
    coupon.repository.ts    — DB access (findById, create, list, etc.)
  services/
    coupon.service.ts       — Orchestration (uses repository + domain)
  routes/
    coupon.routes.ts        — HTTP handlers (thin: validate → service → respond)
```

Frontend page scaffold (Next.js App Router):
When creating a new page section (e.g., seller coupons):
```
apps/seller-panel/src/app/
  (dashboard)/
    kuponlar/
      page.tsx              — Server component, data fetch
      _components/
        coupon-list.tsx     — Client component
        coupon-form.tsx     — Form with schema validation
```

Shared package scaffold:
When adding to packages/ui:
```
packages/ui/src/
  components/
    data-table/
      data-table.tsx
      data-table.types.ts
      index.ts              — Named export
```

Naming conventions:
- Files: kebab-case
- Components: PascalCase
- Functions: camelCase
- Types/Interfaces: PascalCase
- Enums: PascalCase with SCREAMING_SNAKE for values
- DB tables: snake_case (Prisma maps automatically)
- API routes: /api/{domain}/{resource} — REST-style

Scaffold output rules:
1. Always create types file first
2. Repository has no business logic — only DB queries
3. Service imports repository + domain — orchestrates only
4. Route handler validates input, calls service, returns response
5. Export everything from index.ts barrel file
6. Include TODO comments for business logic to fill in

Standard imports to include:
- Repository: import { prisma } from '@/lib/prisma'
- Service: import { {Domain}Repository } from '../repositories/{domain}.repository'
- Route: import { z } from 'zod'; import { {Domain}Service } from '../services/{domain}.service'
- Next.js page: import { getServerSession } from 'next-auth' (or Better Auth equivalent)

When scaffolding a new module:
1. Identify the domain name
2. Identify which layer(s) are needed
3. Create files in the correct directories
4. Use placeholder implementations with TODO markers
5. Add type stubs but don't implement business logic
6. Add to barrel exports

Never scaffold:
- Business logic in route handlers
- DB queries in service layer
- Finance calculations in UI components
- Mixed concerns in a single file
