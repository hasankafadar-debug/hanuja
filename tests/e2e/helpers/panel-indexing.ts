import { test, expect, type APIResponse } from "@playwright/test";

function expectNoIndex(response: APIResponse) {
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
}

/** Read-only checks against a production preview (next start) or CSRF_STRICT dev server. */
export function registerPanelIndexingChecks(
  publicPaths: string[],
  protectedPath: string,
) {
  test("public auth and application surfaces remain unindexed", async ({
    request,
  }) => {
    for (const path of publicPaths) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect([200, 302, 303, 307, 308]).toContain(response.status());
      expectNoIndex(response);
      if (response.status() === 200) {
        const html = await response.text();
        const meta = html.match(/<meta\b[^>]*name="robots"[^>]*>/i)?.[0] ?? "";
        expect(meta).toMatch(/noindex/);
        expect(meta).toMatch(/nofollow/);
      }
    }
  });

  test("robots instructions can be fetched without authentication and allow reading noindex", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expectNoIndex(response);
    const body = await response.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Allow:\s*\//i);
    expect(body).not.toMatch(/Disallow:\s*\//i);
    expect(body).not.toMatch(/sitemap/i);
  });

  test("protected pages still require login and carry the crawler header on redirects", async ({
    request,
  }) => {
    const response = await request.get(protectedPath, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(new URL(response.headers()["location"]!, response.url()).pathname).toBe("/giris");
    expectNoIndex(response);
  });

  test("static files, API responses, missing routes and origin rejections remain unindexed", async ({
    request,
  }) => {
    for (const path of [
      "/favicon.svg",
      "/api/auth/get-session",
      "/api/__indexing-policy-missing__",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBeLessThan(500);
      expectNoIndex(response);
    }
    const missing = await request.get("/api/__indexing-policy-missing__", {
      maxRedirects: 0,
    });
    expect(missing.status()).toBe(404);
    const denied = await request.post("/api/__indexing-policy-missing__", {
      headers: { origin: "https://untrusted.example" },
      maxRedirects: 0,
    });
    expect(denied.status()).toBe(403);
    expectNoIndex(denied);
  });
}
