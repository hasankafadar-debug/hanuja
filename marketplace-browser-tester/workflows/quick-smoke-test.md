# Workflow: Quick Smoke Test

## Trigger
User says: "Run a quick smoke test" or "Just check if the site is up" or similar.

## Purpose
Fast 2-3 minute check that the site loads and all three role logins work.
Does NOT test individual features in depth.

## Orchestrator Steps

### Step 1 — Site Availability
1. Navigate to `baseUrl`
2. Verify: page loads, title is not blank, no 500 error
3. Record: PASS or FAIL

### Step 2 — Customer Login Smoke
1. Navigate to customer login page
2. Log in with customer credentials
3. Verify: dashboard/homepage loads after login
4. Log out
5. Record: PASS or FAIL

### Step 3 — Seller Login Smoke
1. Navigate to seller login page
2. Log in with seller credentials
3. Verify: seller dashboard loads after login
4. Log out
5. Record: PASS or FAIL

### Step 4 — Admin Login Smoke
1. Navigate to admin login page
2. Log in with admin credentials
3. Verify: admin panel loads after login
4. Log out
5. Record: PASS or FAIL

### Step 5 — Report in Chat (No File Needed)

Report directly in chat:
```
## Smoke Test Results

Site: [baseUrl]
Time: [current time]

| Check            | Status     |
|------------------|------------|
| Site Loads       | PASS / FAIL |
| Customer Login   | PASS / FAIL |
| Seller Login     | PASS / FAIL |
| Admin Login      | PASS / FAIL |

Overall: [All systems go! / [N] issue(s) detected]
```

If any check fails: add a brief note on what was observed.

## Duration
Approximately 2-4 minutes for a responsive site.
