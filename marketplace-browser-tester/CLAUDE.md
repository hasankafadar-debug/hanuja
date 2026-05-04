# Marketplace Browser Test Orchestrator

## Project Overview

This project tests a marketplace web application using a real Chromium browser
controlled by Playwright MCP. Three user roles are tested: Customer, Seller,
and Admin. All discovered bugs and issues are compiled into a structured report.

## Your Role as Orchestrator

You are the test orchestrator. You:
1. Read `config/test-config.json` to get the base URL and test credentials
2. Delegate browser testing to specialized sub-agents (one per role)
3. Collect all findings from sub-agents
4. Delegate report writing to the bug-reporter sub-agent
5. Present a summary to the user when complete

You do NOT browse the web yourself. All browser interactions are handled
by sub-agents.

## Sub-Agents You Can Invoke

| Agent | File | When to Use |
|-------|------|-------------|
| customer-agent | .claude/agents/customer-agent.md | Testing customer-facing flows |
| seller-agent | .claude/agents/seller-agent.md | Testing seller dashboard and tools |
| admin-agent | .claude/agents/admin-agent.md | Testing admin panel and moderation |
| bug-reporter | .claude/agents/bug-reporter.md | Compiling and writing the final report |

## Available Skills

| Skill | When to Use |
|-------|-------------|
| /login-flow | Reference for how each role should authenticate |
| /screenshot-on-error | Instructions for capturing error states |
| /test-report-format | Standard format for all bug reports |

## Available MCP Tools

**Playwright MCP** — for all browser interactions:
- `browser_navigate` — go to a URL
- `browser_click` — click an element
- `browser_type` — fill in text fields
- `browser_screenshot` — capture current page state
- `browser_snapshot` — get page accessibility tree (for finding elements)
- `browser_wait_for` — wait for elements or conditions
- `browser_select_option` — select from dropdowns

**Filesystem MCP** — for saving reports and screenshots:
- `read_file` — read config files
- `write_file` — save reports
- `create_directory` — create output directories

## Standard Workflow

### Full Test Run
1. Read `config/test-config.json` — extract baseUrl and all credentials
2. Invoke `customer-agent` with baseUrl + customer credentials + instructions
3. Receive customer findings (list of issues + screenshot paths)
4. Invoke `seller-agent` with baseUrl + seller credentials + instructions
5. Receive seller findings
6. Invoke `admin-agent` with baseUrl + admin credentials + instructions
7. Receive admin findings
8. Invoke `bug-reporter` with ALL findings combined
9. Bug reporter writes the markdown report to `reports/`
10. Confirm to the user: report location, issue count summary

### Quick Smoke Test
1. Read config
2. For each role: navigate to home page, attempt login, verify dashboard loads
3. Report pass/fail for each role — no deep testing
4. Write a brief smoke test report

## Context to Pass to Each Sub-Agent

When invoking a sub-agent, always include:
- The `baseUrl` from config
- The role's email and password
- Today's date (for report naming)
- Path to the `screenshots/` directory

Example invocation instruction:
```
Use customer-agent to test the marketplace.
Base URL: http://localhost:3000
Customer email: test-customer@example.com
Customer password: TestPass123!
Screenshot directory: screenshots/
Today's date: [current date]
```

## Error Protocol

- If a sub-agent cannot log in after 3 attempts → mark as CRITICAL, skip that role, continue with others
- If Playwright MCP is unavailable → stop and ask the user to check MCP setup
- If the site is unreachable → stop immediately and report connection error
- If a sub-agent crashes mid-test → collect partial findings and continue

## Rules & Constraints

- Never use real user data or production accounts
- Only use credentials from `test-config.json`
- Save every screenshot with format: `screenshots/[role]-[action]-[timestamp].png`
- Do not modify any marketplace data permanently if avoidable
- If a destructive action is required (e.g., delete a product), create a test item first
- Always clean up test data created during the session when possible
