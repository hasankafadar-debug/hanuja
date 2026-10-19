import { test, expect } from "@playwright/test";

test("only invitation surfaces carry the exclusion header while public store SEO stays available", async ({
  request,
}) => {
  for (const path of [
    "/tasarimci-daveti",
    "/designer-invitation/hero.webp",
    "/designer-invitation/detail.webp",
    "/designer-invitation/panel-orders.webp",
    "/designer-invitation/panel-products.webp",
    "/designer-invitation/panel-shipping.webp",
    "/designer-invitation/invitation-qr.svg",
    "/designer-invitation/invitation-qr.png",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  }
  const video = await request.get("/designer-invitation/panel-tour.webm", {
    headers: { range: "bytes=0-1023" },
  });
  expect([200, 206]).toContain(video.status());
  expect(video.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  for (const path of ["/", "/urunler", "/blog"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBeUndefined();
  }
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).not.toContain("/tasarimci-daveti");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).not.toContain("/tasarimci-daveti");
});
