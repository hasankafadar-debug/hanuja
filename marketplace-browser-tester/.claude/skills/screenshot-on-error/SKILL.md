---
name: screenshot-on-error
description: Standardized procedure for capturing screenshots when errors or issues are found during browser testing.
---

# Screenshot on Error — Capture Procedure

## When to Take a Screenshot

Take a screenshot in these situations:
- Any page that shows an error message
- Any page that appears blank or partially loaded
- Any form submission that fails
- Any element that appears visually broken or misaligned
- Any unexpected redirect
- At the start of each major test phase
- When a critical feature is not found
- Before and after any significant action (product create, order update, etc.)

## Screenshot Naming Convention

Always use this format:
```
screenshots/[role]-[phase]-[description]-[timestamp].png
```

Examples:
```
screenshots/customer-checkout-payment-form-missing-20240115-143022.png
screenshots/seller-dashboard-revenue-chart-broken-20240115-143501.png
screenshots/admin-usermgmt-ban-button-error-20240115-144230.png
```

Rules:
- `role`: customer | seller | admin
- `phase`: login | dashboard | products | cart | checkout | orders | etc.
- `description`: kebab-case, max 5 words, describe what is shown
- `timestamp`: YYYYMMDD-HHMMSS format

## How to Take a Screenshot

Use the Playwright MCP tool:
```
browser_screenshot with savePath: "screenshots/[formatted-name].png"
```

## What to Capture

### Full Page Screenshots
Use for: dashboard overview, list pages, reports

### Viewport Screenshots (Default)
Use for: error messages, forms, specific UI elements

### Before/After Pairs
When testing an action that should change the UI:
1. Screenshot before the action: `[name]-before.png`
2. Perform the action
3. Screenshot after the action: `[name]-after.png`

## Screenshot Log

After taking each screenshot, log it:
```
SCREENSHOT: screenshots/[filename]
          Description: [one sentence of what is shown]
          Issue: [ISSUE-ID if related to a bug, or "Phase documentation"]
```

Keep this log to include in the final report's screenshot section.

## Screenshots Directory Structure

All screenshots go into `screenshots/` at the project root.
Do NOT create subdirectories — keep all screenshots flat in one folder
for easy report linking.
