/** Escaped, deliberately small Markdown renderer for repository-owned legal text. */
export function renderLegalMarkdown(markdown: string): string {
  const inline = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const html: string[] = []
  let paragraph: string[] = []
  const flush = () => { if (paragraph.length) html.push(`<p>${paragraph.map(inline).join('<br />')}</p>`); paragraph = [] }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) { flush(); continue }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) { flush(); html.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`); continue }
    if (line.startsWith('|')) {
      flush()
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
        if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells)
        i++
      }
      i--
      html.push(`<table><thead><tr>${rows[0]!.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^---+$/.test(line)) { flush(); html.push('<hr />'); continue }
    paragraph.push(line)
  }
  flush()
  return html.join('\n')
}
