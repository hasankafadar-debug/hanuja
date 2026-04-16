---
name: auth-session-flow
description: Apply Hanuja auth, session, and RBAC rules. Use when implementing Better Auth setup, role model (customer/seller/admin), session handling, protected routes, seller onboarding auth, or any authentication/authorization boundary.
user-invocable: false
paths:
  - "api/**/*"
  - "apps/web/src/app/(auth)/**/*"
  - "apps/seller-panel/src/**/*"
  - "apps/admin-panel/src/**/*"
  - "packages/security/**/*"
model: sonnet
effort: high
---

This skill defines Hanuja authentication and session discipline.

Main principle:
Auth is a security boundary, not a UI feature. Every privileged action must be server-side authorized.

Role model:
- customer: browse, purchase, track orders, manage account
- seller: manage own catalog, fulfill orders, view own finance
- admin: full operational oversight, finance control, risk management

Critical truths:
- Authorization must be enforced server-side, never only in frontend
- Role boundaries must be explicit and permission-restricted
- Seller panel must scope all queries to authenticated seller identity
- Admin panel must support partitioned permission levels
- Sessions must be validated on every sensitive action, not only on login

Better Auth setup rules:
1. Central auth configuration — no fragmented auth per app
2. Role-aware session object — include role + sellerId/adminId in session
3. Middleware guards per app — customer routes, seller routes, admin routes separately
4. Protected route pattern — server-side session check in layout or middleware
5. Seller onboarding — registration → approval gate → seller access
6. Admin access — separate login flow or additional verification

Session rules:
- Session must carry minimum necessary claims (userId, role, sellerId if seller)
- Session must be validated on every API call, not cached in client only
- Session invalidation on logout must be complete
- Long-lived privileged sessions must have controls

Seller onboarding flow:
1. User registers with seller intent
2. Business/legal info submitted
3. Admin reviews and approves
4. Seller role activated
5. Seller panel access unlocked
6. Bank detail submission (post-approval)

When implementing auth logic:
- identify the role requirement
- identify the permission boundary
- implement server-side check first
- add audit log for high-impact actions
- test unauthorized access cases explicitly

Never accept:
- client-side-only role checks
- hardcoded admin bypasses
- shared sessions across different roles
- silent permission failures without logging
- seller seeing another seller's data
