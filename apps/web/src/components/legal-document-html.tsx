import { cn } from '@hanuja/ui'

interface LegalDocumentHtmlProps {
  html: string
  className?: string
}

export default function LegalDocumentHtml({
  html,
  className,
}: LegalDocumentHtmlProps) {
  return (
    <article
      className={cn(
        'prose prose-sm max-w-none text-[var(--color-fg)]',
        '[&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-[var(--color-primary)]',
        '[&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[var(--color-primary)]',
        '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[var(--color-primary)]',
        '[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-[var(--color-primary)]',
        '[&_p]:my-2 [&_p]:leading-6',
        '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse',
        '[&_th]:border [&_th]:border-[var(--color-border)] [&_th]:bg-[var(--color-muted)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left',
        '[&_td]:border [&_td]:border-[var(--color-border)] [&_td]:px-3 [&_td]:py-2',
        '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_section]:my-3',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
