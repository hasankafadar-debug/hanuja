/**
 * AnnouncementContent — an admin → seller announcement as the seller sees it.
 * Used by the seller panel detail page and the admin editor preview so both show
 * the same thing. The body is plain text: line breaks are kept, nothing is parsed.
 */
import * as React from "react"
import { cn } from "../../lib/utils"

export type AnnouncementContentMedia =
  | { kind: "image"; url: string }
  /** `url` is null when the video cannot be played from the media host; the poster is shown instead. */
  | { kind: "video"; url: string | null; posterUrl: string | null }

export interface AnnouncementContentProps {
  title: string
  body: string
  sentAt?: string | Date | null
  /** Set when the text was edited after sending. */
  editedAt?: string | Date | null
  media?: AnnouncementContentMedia | null
  className?: string
}

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Europe/Istanbul",
})

function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date)
}

function AnnouncementContent({ title, body, sentAt, editedAt, media, className }: AnnouncementContentProps) {
  const sentLabel = formatDate(sentAt)
  const editedLabel = formatDate(editedAt)

  return (
    <article className={cn("flex flex-col gap-4", className)}>
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight break-words" style={{ color: "var(--color-primary)" }}>
          {title}
        </h2>
        {(sentLabel || editedLabel) && (
          <p className="text-sm text-muted-fg">
            {sentLabel && <span>{sentLabel}</span>}
            {editedLabel && (
              <span>
                {sentLabel ? " · " : ""}Güncellendi: {editedLabel}
              </span>
            )}
          </p>
        )}
      </header>

      {media?.kind === "image" && (
        <img
          src={media.url}
          alt={title}
          loading="lazy"
          className="w-full max-h-[480px] rounded-lg border object-contain"
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}
        />
      )}

      {media?.kind === "video" &&
        (media.url ? (
          <video
            controls
            playsInline
            preload="metadata"
            poster={media.posterUrl ?? undefined}
            src={media.url}
            className="w-full max-h-[480px] rounded-lg border bg-black"
            style={{ borderColor: "var(--color-border)" }}
          >
            Tarayıcınız video oynatmayı desteklemiyor.
          </video>
        ) : (
          <div className="flex flex-col gap-2">
            {media.posterUrl && (
              <img
                src={media.posterUrl}
                alt={title}
                loading="lazy"
                className="w-full max-h-[480px] rounded-lg border object-contain"
                style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-muted)" }}
              />
            )}
            <p className="text-sm text-muted-fg">Video şu anda oynatılamıyor. Lütfen daha sonra tekrar deneyin.</p>
          </div>
        ))}

      <div className="whitespace-pre-wrap break-words text-sm leading-6" style={{ color: "var(--color-primary)" }}>
        {body}
      </div>
    </article>
  )
}

export { AnnouncementContent }
