# Coding Standards

## Purpose

This file defines the non-negotiable coding standards of the Hanuja marketplace.

It exists to keep code generation and maintenance consistent across:

- storefront
- seller panel
- admin panel
- shared packages
- API routes
- domain services
- repositories
- jobs
- tests
- utility modules

If implementation conflicts with this file, this file wins unless a newer approved engineering standard replaces it.

## Core Coding Principle

Hanuja code must optimize for:

1. clarity
2. correctness
3. traceability
4. maintainability
5. safe changeability

Do not optimize for shortest code.
Do not optimize for cleverness.
Do not optimize for “looks smart” abstractions.

Prefer boring, explicit, readable code.

## Language and Type Rules

### TypeScript is the default

TypeScript must be used as the primary language for app and backend code where the approved stack applies.

### Rules

- use strict typing
- avoid `any`
- avoid silent type coercion
- prefer explicit domain types
- use enums or union types where lifecycle meaning matters
- keep shared type meaning centralized where possible

### Do not

- use `any` as a shortcut unless absolutely unavoidable
- hide business meaning behind generic object shapes
- use untyped JSON blobs for core domain behavior if typed structures are practical

## Naming Rules

Names must reflect domain meaning clearly.

### Prefer names like

- `confirmPayment`
- `applySellerPenalty`
- `markDeliveryConfirmed`
- `calculateNetPayout`
- `createPayoutHold`
- `resolveReturnRequest`
- `buildCanonicalProductUrl`

### Avoid names like

- `handleData`
- `processItem`
- `updateThing`
- `runFlow`
- `doAction`
- `helperFunction`

### Naming principles

- functions should describe what they do
- variables should describe what they hold
- files should describe their domain role
- booleans should read clearly as true/false statements
- names should be consistent across layers

## File and Folder Rules

Files and folders should reflect feature/domain responsibility.

### Rules

- group by domain or feature where practical
- avoid giant mixed-purpose folders
- avoid random dumping into `utils`
- keep shared package boundaries meaningful
- keep app-specific code inside the correct app
- keep backend logic in backend/domain layers, not UI folders

### Avoid

- long chains of “misc”, “shared2”, “helpers-final”, “new-utils”
- duplicated logic copied between apps
- deeply confusing folder nesting with no domain reason

## File Size and Complexity Rules

Small and focused files are preferred.

### Rules

- keep files focused on one responsibility
- split files when a second distinct concern emerges
- large files are acceptable only if structure remains clear and domain-local
- avoid multi-hundred-line files that mix UI, data fetching, validation, and business rules together

### Strong warning signs

Refactor when a file starts doing too many of these at once:

- rendering
- schema validation
- auth checks
- business rule evaluation
- database access
- provider integration
- mapping/formatting
- notification logic

## Function Design Rules

Functions should do one clear job.

### Good function behavior

- one clear purpose
- explicit inputs
- explicit outputs
- minimal hidden side effects
- readable branching
- domain meaning visible from the name

### Rules

- keep functions focused
- prefer composition over giant all-in-one functions
- avoid deep nesting when it hurts readability
- extract meaningful sub-functions, not trivial wrappers
- avoid boolean soup in function signatures

### Avoid

- one mega-function for full order/payment/payout lifecycle
- generic helper wrappers that hide important domain logic
- side effects that are not visible from function behavior

## Business Logic Placement Rules

Business logic must live in the correct layer.

### UI layer should handle

- rendering
- interaction
- local view state
- presentational mapping
- simple UI formatting

### API/controller layer should handle

- auth/session resolution
- input validation
- permission boundary
- calling services
- formatting response

### Domain/service layer should handle

- lifecycle transitions
- finance decisions
- payout eligibility
- penalty rules
- refund/offset logic
- seller visibility decisions
- canonical/SEO business generation rules where applicable

### Repository layer should handle

- persistence access
- database queries
- writes/transactions
- fetch/update helpers

### Never do these

- put payout math in React components
- decide penalty logic in route handlers
- decide lifecycle transitions inside repositories
- duplicate business rules in frontend and backend

## React and UI Component Rules

UI components should remain predictable and maintainable.

### Rules

- keep components focused
- separate container logic from reusable UI where helpful
- avoid deeply nested condition trees inside one component
- prefer explicit props over magical context dependence
- keep form logic manageable
- use shared components when a pattern repeats

### Avoid

- giant page components doing everything
- fetching, mapping, validating, and rendering in one uncontrolled file
- passing huge anonymous object props without shape clarity
- using one component for many unrelated modes unless truly justified

## Props and Component API Rules

Component APIs should be stable and understandable.

### Rules

- keep props explicit
- prefer typed props interfaces
- keep prop names consistent across similar components
- avoid prop overload that changes component meaning drastically
- avoid too many optional props that create hidden modes

### Prefer

- small clear component contracts
- specialized wrappers when behavior diverges meaningfully

## Form and Validation Rules

Validation must be explicit and close to the boundary where it matters.

### Rules

- validate external input
- use schema-based validation where appropriate
- separate input validation from business rule validation
- show user-friendly errors in UI
- keep server validation authoritative

### Distinguish clearly

- malformed input
- unauthorized action
- business rule violation
- provider/integration failure
- unexpected system error

## Error Handling Rules

Error handling must be explicit and useful.

### Rules

- fail with meaning
- use stable error categories where possible
- avoid swallowing errors
- log important operational failures appropriately
- keep public error messages controlled
- preserve enough internal detail for debugging

### Do not

- return generic success when part of the action failed
- hide finance/order errors silently
- use `catch {}` with no action
- throw vague unstructured errors everywhere

## Async and Side Effect Rules

Async flows must remain understandable.

### Rules

- await intentionally
- handle failure paths explicitly
- keep side effects visible
- sequence high-risk operations carefully
- use idempotent logic for retryable operations where possible

### Avoid

- fire-and-forget logic for finance-critical work
- hidden async cascades inside helpers
- optimistic assumptions for payment/payout results

## Data Mapping and Serialization Rules

Transformations should be explicit.

### Rules

- map provider payloads into internal domain shapes
- avoid leaking raw external payloads deep into the app
- keep public API response shapes intentional
- use mappers/adapters where external schemas differ from internal models

Do not let Iyzico, cargo, or search provider response shapes become the app’s implicit domain model.

## Utility Rules

Utilities should remain narrow.

### Good utility examples

- date formatting
- money formatting
- slug normalization
- masking helpers
- small pure transformations
- safe parser helpers

### Avoid

- core business rules in generic utility files
- giant “utils.ts” files with mixed unrelated logic
- putting payout or lifecycle policy inside helpers named too generically

## Comment Rules

Comments should explain why, not restate obvious code.

### Good comments

- business reason
- compliance/security constraint
- integration caveat
- non-obvious architectural decision
- temporary workaround with clear context

### Avoid comments like

- `// set value`
- `// loop through array`
- `// if true do this`

If code is confusing without many comments, improve the code first.

## Magic Number and Constant Rules

Avoid unexplained raw constants.

### Rules

- extract meaningful constants when values have business meaning
- keep policy-driven values configurable where appropriate
- name important thresholds clearly

Examples of business-significant values:

- 20-day fulfillment commitment
- 30-day payout hold
- 20% penalty rate
- 72-hour silent delivery confirmation window

Do not scatter these as unexplained raw numbers throughout the codebase.

## Config and Environment Rules

Configuration should be explicit and centralized.

### Rules

- use environment variables for environment-specific secrets/settings
- keep shared config in the right package/file
- validate required config at startup where practical
- separate example config from real config

Do not hardcode secrets or environment-specific assumptions into source files.

## Logging Rules

Logs should support operations and debugging without leaking sensitive data.

### Rules

- log key transitions and failures where useful
- mask secrets and sensitive values
- keep finance/admin/security logs meaningful
- avoid noisy console logging in production paths
- use structured logging patterns where appropriate

### Do not

- log full secrets
- log full bank details broadly
- spam logs with repeated low-value messages
- use logging as the only source of truth for state transitions

## Testing-Oriented Coding Rules

Code should be easy to test.

### Rules

- prefer pure functions where possible for business calculations
- isolate provider integrations behind adapters
- avoid unnecessary hidden global state
- keep domain logic callable outside UI
- make side effects injectable or mockable where practical

Code that cannot be tested usually has unclear responsibility boundaries.

## Reuse Rules

Reuse is good only when it preserves clarity.

### Rules

- reuse shared logic when meaning is truly the same
- duplicate lightly when domains are similar but not actually identical
- avoid abstraction too early
- extract only after a real repeated pattern appears

Do not create generic frameworks inside the repo too early.

## Refactoring Rules

Refactoring should improve clarity, not just move code around.

### Valid refactor goals

- clearer boundaries
- smaller responsibilities
- less duplication
- safer tests
- better domain naming
- better separation of UI and business logic

### Invalid refactor patterns

- renaming everything without benefit
- introducing abstraction without repeated need
- replacing readable code with dense patterns
- hiding business rules behind framework cleverness

## Formatting and Style Rules

Formatting should be automated and boring.

### Rules

- use consistent formatting tools
- do not hand-style code inconsistently
- keep import order stable according to project setup
- keep naming and spacing predictable
- use linting/type checks as enforcement tools

Human attention should go to logic, not formatting debates.

## Branching and Conditional Logic Rules

Branching must remain readable.

### Rules

- make critical conditions explicit
- extract named predicates when clarity improves
- avoid very long compound conditions inline
- prefer early returns when they improve readability
- keep state transitions explicit

### Avoid

- unreadable nested ternaries
- massive condition chains with unclear business meaning
- mixing UI conditions with finance rules in the same branch block

## State Management Rules

State should live in the smallest reasonable place.

### Rules

- keep local UI state local
- keep server truth on the server
- do not duplicate backend truth in fragile frontend assumptions
- use shared/stateful abstractions only when justified
- keep finance and lifecycle truth driven by backend responses

Do not invent client-only truth for payment, payout, or lifecycle-critical values.

## Migration and Backward Compatibility Rules

When changing existing logic:

- preserve auditability
- preserve data meaning
- avoid breaking route or status expectations carelessly
- write migration code intentionally
- update docs when business meaning changes

If a change affects persisted business meaning, think through old data and transition behavior.

## Documentation Rules for Code Changes

When changing code that affects business behavior, update related docs in the same work.

Examples:

- payout logic change → finance docs
- order transition change → lifecycle docs
- route generator change → SEO docs
- bank detail security flow change → security docs

Code and documentation must not drift apart on core behavior.

## Anti-Patterns Claude Must Avoid

Do not:

- use `any` casually
- put business rules in UI
- mix provider payloads directly into domain logic everywhere
- create giant god files
- dump everything into `utils`
- hide important constants as raw numbers
- swallow errors
- over-abstract too early
- duplicate critical logic across apps
- prefer cleverness over clarity

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `.claude/rules/01-architecture.md`
- `.claude/rules/04-seo-rules.md`
- `.claude/rules/05-security-rules.md`
- `.claude/rules/07-marketplace-finance-rules.md`
- `.claude/rules/08-order-lifecycle-rules.md`
- `docs/06-engineering/frontend-architecture.md`
- `docs/06-engineering/backend-architecture.md`
- `docs/06-engineering/api-contracts.md`
- `docs/06-engineering/database-schema.md`

If engineering behavior changes, update the related rule and doc files in the same work.