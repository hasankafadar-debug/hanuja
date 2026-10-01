/**
 * JsonLd — renders a <script type="application/ld+json"> tag for structured data.
 * Place inside the page component (not layout) so each page gets its own schema.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // HTML parses script end tags even inside JSON strings. Escape markup
      // without changing the structured data seen by JSON consumers.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}
