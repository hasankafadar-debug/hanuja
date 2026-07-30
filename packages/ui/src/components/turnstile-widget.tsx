"use client"

import * as React from "react"

declare global {
  interface Window {
    __hanujaTurnstileScriptPromise?: Promise<void>
    turnstile?: {
      remove: (widgetId: string) => void
      render: (
        container: HTMLElement,
        options: {
          action?: string
          callback?: (token: string) => void
          "error-callback"?: () => void
          "expired-callback"?: () => void
          sitekey: string
          size?: "normal" | "flexible" | "compact"
          theme?: "auto" | "dark" | "light"
        },
      ) => string
    }
  }
}

/**
 * Cloudflare renders the widget at no less than this width, even in "flexible" size.
 * A container narrower than this cannot fit the iframe, so it overflows its parent.
 */
const TURNSTILE_MIN_WIDTH = 300

export interface TurnstileWidgetProps {
  action?: string
  className?: string
  /**
   * Scale the widget down when the container is narrower than Turnstile's 300px minimum.
   * Off by default so existing call sites keep their exact rendering.
   */
  fitContainer?: boolean
  onChange: (token: string) => void
  siteKey?: string | undefined
  size?: "normal" | "flexible" | "compact"
  theme?: "auto" | "dark" | "light"
}

function isProductionEnvironment() {
  return (
    (globalThis as typeof globalThis & { process?: { env?: { NODE_ENV?: string } } }).process?.env
      ?.NODE_ENV === "production"
  )
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve()
  }

  if (window.turnstile) {
    return Promise.resolve()
  }

  if (window.__hanujaTurnstileScriptPromise) {
    return window.__hanujaTurnstileScriptPromise
  }

  window.__hanujaTurnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]')
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("turnstile-script-load-failed")), {
        once: true,
      })
      return
    }

    const script = document.createElement("script")
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = "true"
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("turnstile-script-load-failed"))
    document.head.appendChild(script)
  })

  return window.__hanujaTurnstileScriptPromise
}

export function TurnstileWidget({
  action,
  className,
  fitContainer = false,
  onChange,
  siteKey,
  size = "normal",
  theme = "light",
}: TurnstileWidgetProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const widgetIdRef = React.useRef<string | null>(null)
  const [scriptError, setScriptError] = React.useState<string | null>(null)
  const [scale, setScale] = React.useState(1)
  const [scaledHeight, setScaledHeight] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!siteKey) {
      if (!isProductionEnvironment()) {
        onChange("dev-turnstile-bypass")
      } else {
        onChange("")
      }
      return
    }

    onChange("")
    setScriptError(null)

    let cancelled = false

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) {
          return
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          size,
          theme,
          ...(action ? { action } : {}),
          callback: (token) => onChange(token),
          "expired-callback": () => onChange(""),
          "error-callback": () => {
            onChange("")
            setScriptError("Insan dogrulamasi yuklenemedi. Sayfayi yenileyip tekrar deneyin.")
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          onChange("")
          setScriptError("Insan dogrulamasi yuklenemedi. Sayfayi yenileyip tekrar deneyin.")
        }
      })

    return () => {
      cancelled = true
      onChange("")

      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }

      if (containerRef.current) {
        containerRef.current.innerHTML = ""
      }
    }
  }, [action, onChange, siteKey, size, theme])

  React.useEffect(() => {
    if (!fitContainer || typeof ResizeObserver === "undefined") {
      return
    }

    const wrapper = wrapperRef.current
    const container = containerRef.current
    if (!wrapper || !container) {
      return
    }

    // The widget renders at a fixed TURNSTILE_MIN_WIDTH and is then scaled down to whatever
    // width the layout actually gives us. `transform` does not shrink the layout box, so the
    // clamp box height is recomputed from the intrinsic height to avoid dead space below.
    const syncScale = () => {
      const availableWidth = wrapper.clientWidth
      if (!availableWidth) {
        return
      }

      const nextScale = Math.min(1, availableWidth / TURNSTILE_MIN_WIDTH)
      setScale(nextScale)

      const intrinsicHeight = container.offsetHeight
      setScaledHeight(intrinsicHeight > 0 ? intrinsicHeight * nextScale : null)
    }

    syncScale()

    const observer = new ResizeObserver(syncScale)
    observer.observe(wrapper)
    // The container grows from 0 to the widget height once Cloudflare injects its iframe.
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [fitContainer, siteKey])

  if (!siteKey) {
    return !isProductionEnvironment() ? (
      <div
        className={className}
        style={{
          border: "1px dashed var(--color-border, #d4d4d8)",
          borderRadius: 12,
          color: "var(--color-muted-fg, #6b7280)",
          fontSize: 13,
          padding: 12,
        }}
      >
        İnsan doğrulaması bu ortamda kullanılmıyor.
      </div>
    ) : (
      <div
        className={className}
        style={{
          border: "1px solid var(--color-destructive, #dc2626)",
          borderRadius: 12,
          color: "var(--color-destructive, #dc2626)",
          fontSize: 13,
          padding: 12,
        }}
      >
        Insan dogrulamasi su anda kullanilamiyor.
      </div>
    )
  }

  return (
    <div className={className} ref={wrapperRef}>
      <div style={fitContainer ? { height: scaledHeight ?? undefined, overflow: "hidden" } : undefined}>
        <div
          ref={containerRef}
          style={
            fitContainer
              ? {
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  width: TURNSTILE_MIN_WIDTH,
                }
              : undefined
          }
        />
      </div>
      {scriptError ? (
        <p style={{ color: "var(--color-destructive, #dc2626)", fontSize: 12, marginTop: 8 }}>{scriptError}</p>
      ) : null}
    </div>
  )
}
