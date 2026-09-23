/**
 * Seller announcement e-mail (phase 5): escaped admin text, a linked cover image
 * (the image itself or a video's poster), a panel link, and no marketing parts.
 */
import { describe, expect, it } from 'vitest'
import { sellerAnnouncementTemplate } from '../../api/lib/email-templates'

const base = {
  sellerName: 'Atelier <Noa>',
  title: 'Kargo <b>kuralı</b> değişti',
  body: 'İlk paragraf.\nAlt satır <script>alert(1)</script>\n\nİkinci paragraf.',
  panelUrl: 'https://satici.hanuja.com.tr/duyurular/ann1',
}

describe('sellerAnnouncementTemplate', () => {
  it('escapes every admin-written value and keeps the paragraph structure', () => {
    const email = sellerAnnouncementTemplate(base)
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<b>kuralı</b>')
    expect(email.html).toContain('Kargo &lt;b&gt;kuralı&lt;/b&gt; değişti')
    expect(email.html).toContain('Merhaba Atelier &lt;Noa&gt;,')
    expect(email.html).toContain('İlk paragraf.<br />Alt satır &lt;script&gt;')
    expect(email.html).toContain('İkinci paragraf.')
    expect(email.subject).toBe('Hanuja Duyurusu: Kargo <b>kuralı</b> değişti')
  })

  it('links the cover image and the button to the announcement in the panel', () => {
    const email = sellerAnnouncementTemplate({
      ...base,
      coverImageUrl: 'https://media.hanuja.tr/announcements/admin/a.jpg',
    })
    expect(email.html).toContain(
      '<a href="https://satici.hanuja.com.tr/duyurular/ann1" style="display:block;text-decoration:none;"><img src="https://media.hanuja.tr/announcements/admin/a.jpg"',
    )
    expect(email.html).toContain('Duyuruyu Görüntüle')
    expect(email.text).toContain('Duyuruyu görüntüle: https://satici.hanuja.com.tr/duyurular/ann1')
  })

  it('uses a watch button for a video announcement', () => {
    const email = sellerAnnouncementTemplate({
      ...base,
      isVideo: true,
      coverImageUrl: 'https://media.hanuja.tr/announcements/admin/poster.png',
    })
    expect(email.html).toContain('Videoyu İzle')
    expect(email.html).toContain('announcements/admin/poster.png')
    expect(email.text).toContain('Videoyu izle: https://satici.hanuja.com.tr/duyurular/ann1')
  })

  it('drops an unsafe cover URL', () => {
    const email = sellerAnnouncementTemplate({ ...base, coverImageUrl: 'javascript:alert(1)' })
    expect(email.html).not.toContain('javascript:')
    expect(email.html).not.toContain('<img src=')
  })

  it('carries the full text in the plain-text part and no unsubscribe wording', () => {
    const email = sellerAnnouncementTemplate(base)
    expect(email.text).toContain('Merhaba Atelier <Noa>,')
    expect(email.text).toContain(base.body)
    expect(email.text).toContain('operasyonel bir duyurudur')
    expect(`${email.html}${email.text}`.toLowerCase()).not.toContain('abonelik')
  })

  it('shortens a very long subject', () => {
    const email = sellerAnnouncementTemplate({ ...base, title: 'A'.repeat(150) })
    expect(email.subject.length).toBe(120)
    expect(email.subject.endsWith('…')).toBe(true)
  })
})
