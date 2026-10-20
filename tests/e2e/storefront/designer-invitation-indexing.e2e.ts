import { test, expect } from "@playwright/test";

test("only invitation surfaces carry the exclusion header while public store SEO stays available", async ({
  request,
}) => {
  for (const path of [
    "/tasarimci-daveti",
    "/tasarimci-daveti/index.html",
    "/tasarimci-daveti/assets/media/stage-empty-16x9.webp",
    "/tasarimci-daveti/assets/panel/orders.webp",
    "/tasarimci-daveti/assets/products/vesuvio.webp",
    "/tasarimci-daveti/assets/fonts/fonts.css",
    "/tasarimci-daveti/assets/vendor/gsap.min.js",
    "/tasarimci-daveti/qr/hanuja-tasarimci-daveti-qr.svg",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
  const html = await request.get("/tasarimci-daveti");
  expect(await html.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  for (const extension of ["mp4", "webm"]) {
    const video = await request.get(`/tasarimci-daveti/assets/video/stage-16x9.${extension}`, {
      headers: { range: "bytes=0-1023" },
    });
    expect([200, 206]).toContain(video.status());
    expect(video.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  }
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
