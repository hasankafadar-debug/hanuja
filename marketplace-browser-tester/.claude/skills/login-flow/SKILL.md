---
name: login-flow
description: Standard login procedure for each marketplace role using Playwright MCP. Reference this when any agent needs to authenticate.
---

# Login Flow — Standard Authentication Procedure

## Overview

Every role agent must authenticate before running tests.
Follow this exact procedure to ensure reliable login.

## Step-by-Step Login Procedure

### Step 1: Read Configuration
Before navigating anywhere, read the test configuration:
- File: `config/test-config.json`
- Extract: `baseUrl`, `roles.[roleName].email`, `roles.[roleName].password`

### Step 2: Navigate to Login Page

Try these URLs in order until one loads a login form:
1. `[baseUrl]/login`
2. `[baseUrl]/signin`
3. `[baseUrl]/auth/login`
4. `[baseUrl]/[role]/login` (e.g., `/seller/login`, `/admin/login`)
5. Navigate to `[baseUrl]` and look for a "Sign In" or "Login" button

Use `browser_snapshot` after navigating to inspect the page structure.

### Step 3: Find and Fill the Login Form

Use `browser_snapshot` to find:
- Email/username input field
- Password input field
- Submit button

Fill credentials using `browser_type`.

### Step 4: Submit and Verify

After clicking submit:
1. Wait 2-3 seconds for redirect
2. Use `browser_snapshot` to check current state
3. Look for indicators of successful login:
   - User name/avatar in header
   - Dashboard URL in address bar
   - "Welcome" message
   - Navigation menu changed to logged-in state

### Step 5: Handle Login Failure

If login fails:
1. Take a screenshot: `screenshots/[role]-login-failed-[timestamp].png`
2. Note the error message shown
3. Try once more with the same credentials
4. If still fails: record as P1 Critical issue and stop this role's tests

## Role-Specific Login Notes

### Customer Login
- Usually at `/login` or `/signin`
- After login: expect redirect to homepage or `/account`

### Seller Login
- May be at `/seller/login` or `/vendor/login`
- After login: expect redirect to `/seller/dashboard` or `/vendor/dashboard`

### Admin Login
- Usually at `/admin` or `/admin/login`
- After login: expect redirect to `/admin/dashboard`
- If redirected to homepage after admin login → SECURITY BUG (P1)

## Session Verification

After login, always verify the session by:
1. Navigating to a protected page (e.g., `/account` for customer)
2. Confirming the page loads WITHOUT redirecting back to login
3. If redirected to login → session not established, retry or mark as P1

## Logout Procedure

At the end of tests:
1. Find logout button/link (usually in header dropdown or profile menu)
2. Click logout
3. Verify redirect to homepage
4. Verify navigating to protected page now redirects to login
