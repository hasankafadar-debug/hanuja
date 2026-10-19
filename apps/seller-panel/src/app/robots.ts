import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // Crawlers must be able to read noindex headers. Authentication still protects data.
  return { rules: { userAgent: "*", allow: "/" } };
}
