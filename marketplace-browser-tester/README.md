# Marketplace Browser Test Automator

A Claude Code project that uses a real Chromium browser (via Playwright MCP)
to test Customer, Seller, and Admin roles on your marketplace website.
Automatically detects bugs, UI issues, and broken flows — then writes a
structured report.

---

## What It Does

- Opens your marketplace in a real browser (no headless tricks)
- Logs in as Customer → tests browse, search, cart, checkout
- Logs in as Seller → tests dashboard, product listing, order management
- Logs in as Admin → tests user management, moderation, analytics
- Captures screenshots on every error
- Produces a prioritized bug report in `reports/`

---

## Requirements

- Node.js 18+
- Claude Code (VS Code extension or CLI)
- A running instance of your marketplace (local or remote)

---

## Setup

### Step 1 — Clone / Copy This Project

Place all files into a folder and open it in VS Code.

### Step 2 — Configure Your Marketplace URL & Test Accounts

Edit `config/test-config.json`:

```json
{
  "baseUrl": "http://localhost:3000",
  "roles": {
    "customer": {
      "email": "test-customer@example.com",
      "password": "TestPass123!"
    },
    "seller": {
      "email": "test-seller@example.com",
      "password": "TestPass123!"
    },
    "admin": {
      "email": "test-admin@example.com",
      "password": "TestPass123!"
    }
  }
}
```

> Create these test accounts in your marketplace before running.

### Step 3 — Install Playwright MCP

Claude Code will use Playwright automatically via `.mcp.json`.
On first run it downloads Chromium (one-time, ~150 MB).

If you want to pre-install:
```bash
npx @playwright/mcp@latest install-deps
```

### Step 4 — Open Claude Code in This Folder

```bash
cd marketplace-browser-tester
claude
```

Or open the folder in VS Code and use the Claude Code extension.

---

## Running Tests

### Full Test Suite (All 3 Roles)
In Claude Code, type:
```
Run the full marketplace test suite for all roles
```

### Single Role Test
```
Test only the customer role on the marketplace
Test only the seller dashboard
Test only the admin panel
```

### Quick Smoke Test
```
Run a quick smoke test — just check if the main pages load
```

### Custom Scenario
```
Test the checkout flow as a customer and report any payment errors
```

---

## Output

After each run you will find:

| Location | Contents |
|----------|----------|
| `reports/YYYY-MM-DD_HH-MM_full-report.md` | Complete bug report |
| `screenshots/` | PNG screenshots of every error |

### Report Structure
```
# Marketplace Test Report — [date]

## Executive Summary
## Critical Issues (P1)
## High Priority Issues (P2)
## Medium Priority Issues (P3)
## Low Priority / Suggestions (P4)
## Passed Tests
## Test Coverage
```

---

## Agent Architecture

```
You (Claude Code)
       │
       ▼
Orchestrator (CLAUDE.md)
       │
  ┌────┼────┐────────────┐
  ▼    ▼    ▼            ▼
Customer Seller Admin  Bug Reporter
 Agent   Agent  Agent   Agent
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Browser doesn't open | Run `npx playwright install chromium` |
| Login fails | Check credentials in `test-config.json` |
| Site unreachable | Confirm `baseUrl` is correct and server is running |
| Slow tests | Normal — real browser is slower than API tests |
| Screenshots not saving | Check write permissions on `screenshots/` |
