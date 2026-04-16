/**
 * JsonLd — renders a <script type="application/ld+json"> tag for structured data.
 * Place inside the page component (not layout) so each page gets its own schema.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}
