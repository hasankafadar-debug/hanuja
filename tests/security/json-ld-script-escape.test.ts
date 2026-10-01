import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsonLd } from '../../packages/seo/src/json-ld'

afterEach(() => vi.unstubAllGlobals())

describe('structured data HTML boundary', () => {
  it.each([
    '</script><script id="audit-proof">void 0</script>',
    '</ScRiPt><img src=x onerror="void 0">',
    '<!-- <script> Çiçek & ürün > açıklaması',
  ])('keeps untrusted product text inside one JSON script: %s', (name) => {
    vi.stubGlobal('React', React)
    const data = { '@type': 'Product', name }
    const markup = renderToStaticMarkup(React.createElement(JsonLd, { data }))
    expect(markup.match(/<script\b/gi)).toHaveLength(1)
    expect(markup.match(/<\/script>/gi)).toHaveLength(1)
    const json = markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</script>'))
    expect(json).not.toContain('<')
    expect(JSON.parse(json)).toEqual(data)
  })
})
