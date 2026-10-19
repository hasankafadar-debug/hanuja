# Invitation and panel indexing policy

The public storefront, catalog and blog remain indexable under their existing SEO policy. The unlisted designer invitation and the complete designer/admin applications are excluded from search indexing.

| Surface                       | HTTP header                                                | HTML metadata                                                         | Crawler access                                                         |
| ----------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/tasarimci-daveti`           | `X-Robots-Tag: noindex, nofollow`                          | Page `robots` and Googlebot metadata also exclude indexing            | Not blocked in storefront `robots.txt`; absent from sitemap/navigation |
| `/designer-invitation/*`      | `X-Robots-Tag: noindex, nofollow`                          | Not applicable to image/video/QR files                                | Crawlable so the response header can be read                           |
| Entire seller and admin hosts | `X-Robots-Tag: noindex, nofollow` on all Next.js responses | Existing root `robots: noindex, nofollow`; seller auth layout aligned | Public `/robots.txt` allows crawling; no panel sitemap is published    |

The global panel header covers public login/password/application routes, protected-page redirects, APIs, static files and missing routes. Authentication, roles, session validation, CSRF cookies and origin checks remain the data-access controls. A crawler can fetch the public login page or receive the usual login redirect; allowing crawling does not grant access to account data.

`robots.txt` does not use `Disallow: /`: Google must be able to fetch a URL to read its `noindex` instruction. A crawl-blocked URL can still appear in search results when linked elsewhere. Google supports both HTML metadata and the `X-Robots-Tag` response header for exclusion. See [Google Search Central: Block search indexing with noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

These instructions do not remove previously indexed URLs immediately. Existing results can remain until Google recrawls the URLs and processes the exclusion. No claim is made that search results have already disappeared. No Search Console removal request is issued by this change.

Read-only HTTP regression checks are in `tests/e2e/{admin-panel,seller-panel}/indexing.e2e.ts` and `tests/e2e/storefront/designer-invitation-indexing.e2e.ts`. Run against production previews or a development server with strict origin checks enabled. They exercise auth/application metadata, redirects, robots, static/API/error responses, origin rejection and the storefront exclusion boundary.
