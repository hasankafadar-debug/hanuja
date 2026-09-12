import { Skeleton } from '@hanuja/ui'

export default function AdminPanelLoading() {
  return (
    <div
      className="max-w-5xl space-y-6"
      role="status"
      aria-live="polite"
      aria-label="Panel içeriği yükleniyor"
      aria-busy="true"
      data-testid="admin-panel-loading"
    >
      <span className="sr-only">Yükleniyor</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <div
        className="space-y-3 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-4/5" />
      </div>
    </div>
  )
}
