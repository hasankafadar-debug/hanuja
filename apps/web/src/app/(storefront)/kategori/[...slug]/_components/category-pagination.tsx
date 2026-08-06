interface SeoPaginationLinksProps {
  hrefs: Array<{ page: number; href: string }>
}

/**
 * Visually hidden, crawlable links to pages 2..N.
 *
 * The product grid loads further pages on scroll, which a crawler never
 * triggers. Without these anchors only the first page of products would stay
 * linked from the listing, orphaning the rest. The `?sayfa=N` URLs still render
 * server-side, so each one is a real, indexable page.
 */
export function SeoPaginationLinks({ hrefs }: SeoPaginationLinksProps) {
  if (hrefs.length === 0) return null

  return (
    <nav aria-label="Sayfalar" className="sr-only">
      <ul>
        {hrefs.map(({ page, href }) => (
          <li key={page}>
            <a href={href}>{page}. sayfa</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
