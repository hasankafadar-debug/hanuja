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
          theme?: "auto" | "dark" | "light"
        },
      ) => string
    }
  }
}

export interface TurnstileWidgetProps {
  action?: string
  className?: string
  onChange: (token: string) => void
  siteKey?: string | undefined
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
  onChange,
  siteKey,
  theme = "light",
}: TurnstileWidgetProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const widgetIdRef = React.useRef<string | null>(null)
  const [scriptError, setScriptError] = React.useState<string | null>(null)

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
  }, [action, onChange, siteKey, theme])

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
          border: "1px solid var(--color-danger, #dc2626)",
          borderRadius: 12,
          color: "var(--color-danger, #dc2626)",
          fontSize: 13,
          padding: 12,
        }}
      >
        Insan dogrulamasi su anda kullanilamiyor.
      </div>
    )
  }

  return (
    <div className={className}>
      <div ref={containerRef} />
      {scriptError ? (
        <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 12, marginTop: 8 }}>{scriptError}</p>
      ) : null}
    </div>
  )
}
