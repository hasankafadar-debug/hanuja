function Bar({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ backgroundColor: 'var(--color-muted)' }}
    />
  )
}

export default function OrderDetailLoading() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true" aria-live="polite">
      <Bar className="h-4 w-40" />

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Bar className="h-6 w-48" />
          <Bar className="h-4 w-32" />
        </div>
        <Bar className="h-7 w-24" />
      </div>

      <div className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
        <Bar className="mb-4 h-4 w-32" />
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <Bar className="h-16 w-16 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bar className="h-4 w-3/4" />
                <Bar className="h-3 w-1/3" />
              </div>
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
          <Bar className="mb-4 h-4 w-28" />
          <div className="space-y-2">
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-5/6" />
            <Bar className="h-3 w-2/3" />
          </div>
        </div>
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
          <Bar className="mb-4 h-4 w-28" />
          <div className="space-y-2">
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-4/6" />
            <Bar className="h-3 w-1/2" />
          </div>
        </div>
      </div>
    </div>
  )
}
