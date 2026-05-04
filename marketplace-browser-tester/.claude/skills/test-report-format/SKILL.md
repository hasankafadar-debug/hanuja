---
name: test-report-format
description: Standard format for documenting individual bugs and test results during browser testing. Use this format for every issue found.
---

# Test Report Format — Bug Documentation Standard

## Single Issue Format

Use this exact format for every bug or issue found:

```
ISSUE:
  ID: [auto-increment: ISSUE-001, ISSUE-002, ...]
  Role: [Customer / Seller / Admin]
  Phase: [Phase name from test checklist]
  URL: [complete URL where the issue was found]
  Severity: [P1-Critical / P2-High / P3-Medium / P4-Low]
  Title: [Short, descriptive title — max 10 words]
  Steps to Reproduce:
    1. [First step — start from logged-out or logged-in state]
    2. [Next step]
    3. [Step where the issue occurs]
  Expected: [What should happen according to normal behavior]
  Actual: [What actually happened]
  Screenshot: [Filename in screenshots/ dir, or "None"]
  Notes: [Any additional context, e.g., "Only happens in Chrome", "Intermittent"]
```

## Severity Classification

### P1 — Critical (Fix immediately, blocks usage)
- Core feature completely broken
- Security vulnerability
- Data loss risk
- Site crash or white screen
- Cannot log in
- Cannot complete purchase (checkout broken)

Examples:
- "Login form returns 500 error"
- "Admin panel accessible without authentication"
- "Cart loses items on page refresh"

### P2 — High (Fix before launch)
- Feature works but with significant errors
- Data displayed incorrectly
- Key action fails sometimes
- Missing required fields

Examples:
- "Product price shows as $0 after discount applied"
- "Order status update button unresponsive"
- "Seller dashboard shows another seller's data"

### P3 — Medium (Fix in next sprint)
- Non-blocking UX issues
- Minor calculation errors
- Layout problems that don't prevent use
- Missing validation messages

Examples:
- "Filter dropdown doesn't close after selection"
- "Error message is technically incorrect"
- "Mobile layout breaks below 375px"

### P4 — Low (Backlog)
- Cosmetic issues
- Typos
- Minor spacing/alignment
- Nice-to-have improvements

Examples:
- "Button text has typo: 'Procede' instead of 'Proceed'"
- "Footer link opens in same tab instead of new tab"
- "Loading spinner misaligned by 5px"

## Pass Documentation Format

For tests that pass, record briefly:

```
PASS: [Phase] — [What was tested]
Example:
PASS: Login — Customer successfully logs in with valid credentials
PASS: Cart — Adding product updates cart count in header
PASS: Checkout — Shipping address form validates required fields correctly
```

## End-of-Role Summary Format

After completing all phases for a role:

```
=== [ROLE] TEST SUMMARY ===
Total Tests: [N]
Passed: [N]
Issues Found: [N]
  P1 Critical: [N]
  P2 High: [N]
  P3 Medium: [N]
  P4 Low: [N]
Screenshots Taken: [N]
==========================
```
