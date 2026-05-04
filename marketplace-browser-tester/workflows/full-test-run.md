# Workflow: Full Test Run (All 3 Roles)

## Trigger
User says: "Run the full marketplace test suite" or similar.

## Prerequisites
- `config/test-config.json` is filled with correct URL and credentials
- Marketplace server is running and accessible
- Playwright MCP is available

## Orchestrator Steps

### Step 0 — Pre-flight Check
1. Read `config/test-config.json`
2. Attempt `browser_navigate` to `baseUrl`
3. If site unreachable → stop, report connection error
4. If site loads → proceed

### Step 1 — Customer Role Test
Invoke `customer-agent` with this context:
```
Run the full customer test suite.
Base URL: [baseUrl from config]
Email: [customer.email]
Password: [customer.password]
Screenshot directory: screenshots/
Test data: [testData from config]
Today's datetime: [current datetime]
```
Wait for completion. Store the returned report.

### Step 2 — Seller Role Test
Invoke `seller-agent` with this context:
```
Run the full seller test suite.
Base URL: [baseUrl from config]
Email: [seller.email]
Password: [seller.password]
Screenshot directory: screenshots/
Test data: [testData from config]
Today's datetime: [current datetime]
```
Wait for completion. Store the returned report.

### Step 3 — Admin Role Test
Invoke `admin-agent` with this context:
```
Run the full admin test suite.
Base URL: [baseUrl from config]
Email: [admin.email]
Password: [admin.password]
Screenshot directory: screenshots/
Test data: [testData from config]
Today's datetime: [current datetime]
```
Wait for completion. Store the returned report.

### Step 4 — Compile Report
Invoke `bug-reporter` with:
```
Compile the final test report.
Customer report: [full customer-agent output]
Seller report: [full seller-agent output]
Admin report: [full admin-agent output]
Test date: [current datetime in YYYY-MM-DD_HH-MM format]
Base URL: [baseUrl]
```
Wait for report to be written.

### Step 5 — Final Summary to User
Present this summary in chat:
```
## Marketplace Test Complete

Report saved to: reports/[filename]

### Quick Summary
| Role     | Tests | Passed | Issues |
|----------|-------|--------|--------|
| Customer | [N]   | [N]    | [N]    |
| Seller   | [N]   | [N]    | [N]    |
| Admin    | [N]   | [N]    | [N]    |
| Total    | [N]   | [N]    | [N]    |

### Critical Issues Requiring Immediate Attention
[List P1 issues by title, or "None — site looks healthy!"]

Open reports/[filename] for the full detailed report.
```

## Error Handling

| Situation | Action |
|-----------|--------|
| Site unreachable | Stop immediately, report URL/connection issue |
| Login fails for a role | Mark all tests for that role as blocked, continue with other roles |
| Agent crashes mid-test | Collect partial results, note incomplete coverage in report |
| Playwright MCP unavailable | Stop, show setup instructions from README |
