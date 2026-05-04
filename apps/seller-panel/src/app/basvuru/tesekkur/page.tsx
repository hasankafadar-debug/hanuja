export default function BasvuruTesekkurPage() {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="max-w-xl w-full rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-neutral-900 mb-2">Basvurunuz alindi</p>
        <h1 className="text-2xl font-semibold text-neutral-900 mb-3">
          Satici basvurunuz incelemeye alindi
        </h1>
        <p className="text-sm leading-6 text-neutral-600">
          Ekibimiz bilgilerinizi kontrol ettikten sonra sizinle iletisime gececek.
          Bu asamada yeni bir basvuru yapmaniza gerek yoktur.
        </p>
      </div>
    </div>
  )
}
