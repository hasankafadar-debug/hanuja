import { describe, expect, it } from 'vitest'
import { sanitizeBlogHtml } from '../../api/lib/sanitize-blog-html'

describe('sanitizeBlogHtml', () => {
  it('keeps the limited blog markup and strips unsafe tags and attrs', () => {
    const input =
      '<h2 onclick="alert(1)">Baslik</h2><p>Merhaba <strong>Hanuja</strong></p><script>alert(1)</script><a href="/kategori/sehpa" target="_blank" rel="noreferrer">Sehpa</a>'

    expect(sanitizeBlogHtml(input)).toBe(
      '<h2>Baslik</h2><p>Merhaba <strong>Hanuja</strong></p><a href="/kategori/sehpa">Sehpa</a>',
    )
  })

  it('drops external or malformed href values', () => {
    const input =
      '<a href="https://example.com">dis</a><a href="javascript:alert(1)">js</a><a href="/urun/test">ic</a>'

    expect(sanitizeBlogHtml(input)).toBe('<a>dis</a><a>js</a><a href="/urun/test">ic</a>')
  })
})
