/**
 * FormField — label + field + error message wrapper.
 * Wraps any input-like component with consistent layout and accessibility.
 */
import * as React from "react"
import { cn } from "../../lib/utils"
import { Label } from "../label"

export interface FormFieldProps {
  label: string
  htmlFor: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
  className?: string
}

function FormField({ label, htmlFor, required, error, hint, children, className }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-fg">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export { FormField }
