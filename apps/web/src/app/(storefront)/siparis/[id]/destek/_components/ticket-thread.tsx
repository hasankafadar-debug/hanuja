'use client'

import { FileText, Image as ImageIcon } from 'lucide-react'

interface Attachment {
  id: string
  mediaAsset: {
    id: string
    url: string
    originalName: string | null
    mimeType: string
  }
}

interface Message {
  id: string
  authorRole: 'customer' | 'admin' | 'seller'
  body: string
  createdAt: string
  attachments: Attachment[]
}

interface TicketThreadProps {
  messages: Message[]
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const { mediaAsset } = attachment
  const isImage = mediaAsset.mimeType.startsWith('image/')
  const name = mediaAsset.originalName ?? 'Ek'

  return (
    <a
      href={mediaAsset.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
    >
      {isImage ? (
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="max-w-[200px] truncate">{name}</span>
    </a>
  )
}

export function TicketThread({ messages }: TicketThreadProps) {
  if (messages.length === 0) {
    return (
      <p className="py-4 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Henüz mesaj yok.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const isCustomer = message.authorRole === 'customer'
        const date = new Date(message.createdAt).toLocaleDateString('tr-TR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })

        return (
          <div
            key={message.id}
            className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[85%] ${isCustomer ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
              <div
                className="rounded-xl px-4 py-3 text-sm leading-relaxed"
                style={{
                  backgroundColor: isCustomer
                    ? 'var(--color-blue-50, #eff6ff)'
                    : 'var(--color-muted, #f3f4f6)',
                  color: 'var(--color-primary)',
                }}
              >
                {!isCustomer && (
                  <p
                    className="mb-1 text-xs font-semibold"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    Hanuja Destek
                  </p>
                )}
                <p className="whitespace-pre-wrap">{message.body}</p>
              </div>

              {message.attachments.length > 0 && (
                <div className={`flex flex-wrap gap-1.5 ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                  {message.attachments.map((att) => (
                    <AttachmentLink key={att.id} attachment={att} />
                  ))}
                </div>
              )}

              <p
                className="text-xs"
                style={{ color: 'var(--color-muted-fg)' }}
              >
                {date}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
