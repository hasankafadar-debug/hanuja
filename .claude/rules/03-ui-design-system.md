# UI Design System Rules

## Purpose

This file defines the non-negotiable UI and design system rules of the Hanuja marketplace.

It exists to keep design decisions consistent across:

- storefront
- seller panel
- admin panel
- shared components
- forms
- tables
- states
- mobile and desktop layouts
- accessibility and readability
- brand presentation

If implementation conflicts with this file, this file wins unless an explicitly approved design decision replaces it.

## Core Design Principle

Hanuja should feel:

- curated
- modern
- calm
- trustworthy
- premium without being flashy
- operationally clear

The design system must support both:

- emotional brand value on the customer-facing storefront
- high clarity and low error risk in seller/admin tools

Do not design for visual novelty first.
Design for trust, clarity, and maintainability first.

## Design Priority Order

When design decisions conflict, use this priority:

1. clarity
2. usability
3. consistency
4. accessibility
5. trust and visual calm
6. responsiveness
7. elegance
8. decorative uniqueness

Never sacrifice clarity for aesthetics.

## Experience Layers

Hanuja has three major UX surfaces and each one has a different tone.

### Storefront
Should feel:

- refined
- inspiring
- curated
- warm
- trustworthy
- commercially strong

### Seller panel
Should feel:

- practical
- clear
- efficient
- transparent
- operational

### Admin panel
Should feel:

- dense but readable
- control-oriented
- risk-aware
- explicit
- safe for high-impact actions

Do not use the exact same interface tone for all three surfaces.

## Global Visual Language

The overall visual language should be:

- clean layouts
- generous whitespace
- restrained color usage
- strong typography hierarchy
- rounded but not childish surfaces
- clear borders/dividers where useful
- simple shadows, not heavy visual noise
- clear interactive states

Avoid:

- overly glossy UI
- crowded cards everywhere
- unnecessary gradients
- oversized decorative icons
- trendy but low-clarity patterns

## Layout Rules

### General layout principles

- prefer predictable grids
- prefer modular sections
- avoid overly deep nested containers
- keep page width decisions intentional
- use clear spacing rhythm
- maintain consistent content alignment

### Storefront layout

Storefront should use:

- content-led layouts
- strong hero/section rhythm
- curated product grouping
- breathing room around imagery
- visually clear product cards
- obvious navigation hierarchy

### Seller/admin layout

Operational panels should use:

- left navigation or clear structural navigation
- compact but readable content zones
- explicit filter/action areas
- sticky summaries when useful
- tables and cards only where appropriate

Do not force storefront-style visual patterns into admin tools.

## Grid and Spacing Rules

Use a consistent spacing system.

### Rules

- spacing must follow a repeatable scale
- similar content blocks should share spacing behavior
- page headers, section headers, cards, and forms must align consistently
- avoid random one-off padding/margin values

### Preference

Choose a spacing system that makes it easy to visually scan:

- small spacing for grouped data
- medium spacing for component separation
- large spacing for section separation

Do not let each page invent its own spacing logic.

## Typography Rules

Typography should be one of Hanuja’s strongest design tools.

### Principles

- clear hierarchy
- good line length
- readable paragraph spacing
- restrained font family count
- distinguish editorial, commerce, and operational text appropriately

### Recommended hierarchy behavior

Use clear distinctions for:

- page title
- section title
- component title
- body text
- support text
- labels
- table metadata
- warning/help text

### Rules

- avoid tiny unreadable support text
- avoid overusing bold
- avoid decorative uppercase everywhere
- maintain contrast and readability
- use consistent heading patterns across the app

## Color System Rules

Color should communicate hierarchy and state, not decorate randomly.

### Color roles should be defined for

- primary brand color
- surface/background colors
- border/divider colors
- text hierarchy
- success state
- warning state
- danger/error state
- info/neutral state

### Rules

- brand color should not appear everywhere
- destructive colors must be reserved for destructive meaning
- state colors must be consistent across storefront, seller, and admin
- neutral backgrounds should stay calm and readable
- low-contrast fashionable palettes must not reduce usability

Avoid using color alone to convey meaning.
Always pair important states with labels/icons/text.

## Component System Rules

All repeated UI patterns should become reusable components.

Core shared component areas should include:

- buttons
- inputs
- selects
- textareas
- checkboxes/radios/switches
- badges/status chips
- alerts/notices
- modals/dialogs
- dropdowns
- tabs
- breadcrumbs
- cards
- tables
- pagination
- empty states
- loading states
- skeletons
- toasts
- drawers/sheets where appropriate

### Rules

- do not recreate similar components with slightly different styling on every page
- shared components should have predictable API and visual behavior
- component variants should be intentional
- avoid unbounded variant explosion

## Button Rules

Buttons must communicate action weight clearly.

### Button roles

At minimum define:

- primary action
- secondary action
- tertiary/subtle action
- destructive action
- ghost/text action where appropriate

### Rules

- only one main primary action should dominate a local decision area
- destructive actions must be visually distinct
- disabled buttons must still be understandable
- loading states must be visible
- button copy should be explicit

Avoid multiple equally dominant primary buttons in one zone.

## Form Design Rules

Forms are high-impact in seller/admin experiences and must reduce mistakes.

### Rules

- labels must be clear and persistent
- required vs optional fields must be explicit
- validation must be understandable
- field grouping must reflect mental model
- destructive or finance-sensitive edits should include warnings where needed
- submit actions must be explicit and well-positioned

### Validation rules

- validate close to the field
- do not rely only on toast-based validation
- use human-readable error messages
- preserve user input where possible on error
- use confirm steps for high-impact submissions when needed

### Avoid

- unlabeled icon-only form controls
- placeholder-only labeling
- huge forms with no grouping
- ambiguous save/update behavior

## Table Rules

Tables are critical for seller/admin panels.

### Tables should support

- strong column clarity
- sortable fields where appropriate
- filters/search where operationally needed
- sticky headers when useful
- clear row click/action behavior
- readable empty/loading states

### Rules

- do not overload tables with too many weak columns
- important statuses should be scannable
- actions should not be hidden in confusing places
- numeric/financial columns should align consistently
- timestamps should be clear

Use cards instead of tables only when records are few and scanning benefits from card layout.

## Status and Badge Rules

Statuses must be visually and semantically consistent.

### Statuses should be represented with

- clear label
- consistent color mapping
- optional icon when useful
- tooltip/help text where ambiguity exists

### Rules

- similar meanings must use similar visual language
- avoid inventing new badge colors per page
- payout/order/risk/return states should remain visually distinct but systematic
- do not hide critical states behind generic labels like “processing”

## Card Rules

Cards should be used intentionally, not as default decoration.

### Good use cases

- product cards
- summary cards
- compact status summaries
- curated content modules

### Avoid

- wrapping every admin detail in deep nested cards
- using cards where tables or sections would be clearer
- excessive shadow-based separation

## Navigation Rules

Navigation must reflect information architecture clearly.

### Storefront navigation

Should support:

- category discovery
- search-first or category-first browsing
- curated collection exploration
- blog/editorial access where relevant
- store page discovery where relevant

### Seller/admin navigation

Should support:

- task-first access
- stable section grouping
- predictable path to orders/finance/settings
- low cognitive load

### Rules

- avoid hidden critical navigation paths
- avoid route ambiguity in labels
- use consistent terminology across nav and page headers

## Search and Filter UI Rules

Search and filters must be understandable and not visually overwhelming.

### Rules

- separate filter controls from sort controls
- show active filters clearly
- allow reset/clear actions
- maintain a stable layout when filters change
- avoid making filters feel like hidden advanced tools when they are central

### Storefront-specific note

Storefront filters should feel light and usable, but they must not create SEO confusion in route/index behavior.

## Empty State Rules

Every important page/view should have a designed empty state.

### Empty states should explain:

- what is missing
- why it is missing
- what the user can do next

### Examples

- no orders yet
- no products yet
- no payout-ready balance
- no search results
- no return requests
- no penalties

Do not leave blank white sections with no guidance.

## Loading and Skeleton Rules

Loading behavior must feel stable and intentional.

### Rules

- use skeletons for content blocks where structure is known
- use spinners sparingly
- avoid jarring layout shifts
- loading states should match likely final layout
- destructive or finance-sensitive actions should show clear pending state

## Feedback and Notification Rules

Feedback must help users understand system result.

### Use appropriate feedback types

- inline field validation
- section-level warning/info messages
- toast for lightweight success/info
- modal confirmation for high-risk actions
- persistent banners for important account/system conditions

### Rules

- do not rely only on toasts for critical outcomes
- finance/order-impacting outcomes should remain visible beyond a transient toast
- warnings must be specific

## Error State Rules

Errors should be actionable, not generic.

### Rules

- error messages should state what failed
- where possible, suggest next step
- operational tools should expose enough clarity to resolve issues
- do not leak sensitive internals
- do not reduce everything to “Something went wrong”

## Accessibility Rules

Accessibility is required, not optional.

### Minimum expectations

- semantic HTML where possible
- keyboard accessibility
- focus visibility
- sufficient color contrast
- labels for form controls
- accessible dialog behavior
- sensible heading order
- readable touch targets
- screen-reader-friendly names for important interactive elements

Do not hide poor usability behind visual polish.

## Mobile Responsiveness Rules

Mobile behavior must be intentional on storefront and at least reliably usable on seller/admin surfaces.

### Storefront mobile expectations

- browsing must remain comfortable
- filters/search/navigation must stay usable
- product cards and detail pages must remain readable
- content hierarchy must not collapse into clutter

### Seller/admin mobile expectations

- key operational tasks should remain possible
- dense tables may adapt into stacked layouts where needed
- destructive/high-impact actions must remain safe on smaller screens

Do not design desktop-first and leave mobile as accidental overflow.

## Brand Expression Rules

Hanuja should feel premium through restraint.

### Brand expression should come from

- typography discipline
- image presentation
- spacing
- calm surfaces
- confident hierarchy
- curated merchandising blocks

Avoid trying to feel premium through:

- visual noise
- luxury clichés
- excessive animation
- glittery gradients
- over-styled controls

## Motion Rules

Use motion only when it helps comprehension.

### Appropriate motion examples

- menu open/close
- modal entrance/exit
- tab/content transitions
- loading feedback
- subtle hover/focus response

### Rules

- motion must be fast and restrained
- do not use theatrical animations
- do not slow operational work with transitions
- reduced-motion preferences should be respected

## Visual Consistency Rules

If a pattern exists in more than one place, it should usually share a system rule.

Examples:

- same order status → same status treatment
- same payout block state → same warning pattern
- same form structure → same field and button rhythm
- same destructive action → same confirmation style

Do not let each page become its own mini design language.

## Storefront Content Presentation Rules

For the storefront, content presentation should support both inspiration and conversion.

### Rules

- use strong product imagery
- keep merchandising sections curated
- avoid cramped product grids
- preserve room for editorial storytelling where relevant
- price, title, and product essence should be scannable
- promotional blocks must not overpower trust and clarity

## Seller/Admin Information Density Rules

Operational panels may be denser, but density must stay controlled.

### Rules

- dense does not mean cluttered
- always expose hierarchy
- group related controls and data
- use summaries before deep detail when possible
- keep blocking/warning states obvious

## Documentation and Handoff Rules

All major UI decisions should remain aligned with:

- wireframes
- design system docs
- component inventory
- UX flows
- status/state definitions

Do not let implementation invent a parallel undocumented design system.

## Things Claude Must Not Do

Do not:

- use a different visual language on every page
- prioritize trendy visuals over clarity
- overload admin/seller tools with storefront-style decoration
- invent new component variants casually
- rely on color only for important meaning
- hide critical finance/order states in weak badges
- use placeholder-only labels in forms
- make destructive actions visually casual
- create layout inconsistency across similar screens
- treat mobile responsiveness as optional

## Cross-Reference Files

Always align this file with:

- `CLAUDE.md`
- `.claude/rules/00-project-scope.md`
- `docs/03-design/design-principles.md`
- `docs/03-design/design-system.md`
- `docs/03-design/color-typography.md`
- `docs/03-design/layout-grid.md`
- `docs/03-design/component-inventory.md`
- `docs/03-design/homepage-wireframe.md`
- `docs/03-design/category-page-wireframe.md`
- `docs/03-design/product-page-wireframe.md`
- `docs/03-design/seller-panel-wireframe.md`
- `docs/03-design/admin-panel-wireframe.md`

If core UI system logic changes, update the related design docs in the same work.