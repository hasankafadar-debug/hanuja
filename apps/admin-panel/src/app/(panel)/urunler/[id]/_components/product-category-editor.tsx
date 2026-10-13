'use client'
import { csrfFetch } from '@/lib/csrf-fetch'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label } from '@hanuja/ui'
import {
  allowedSizeValues,
  fieldOptions,
  variantPropertyKey,
  type ResolvedCategorySchema,
  type ProductProperties,
} from '@hanuja/api/domain/category-schema'
type Category = { id: string; name: string; parentId: string | null }
export default function ProductCategoryEditor({
  productId,
  categoryId,
  properties,
  variants,
  categories,
}: {
  productId: string
  categoryId: string | null
  properties: ProductProperties
  variants: Array<{ id: string; name: string; properties: ProductProperties }>
  categories: Category[]
}) {
  const router = useRouter(),
    [target, setTarget] = useState(categoryId ?? ''),
    [schema, setSchema] = useState<ResolvedCategorySchema | null>(null),
    [values, setValues] = useState(properties),
    [rows, setRows] = useState(variants),
    [unit, setUnit] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const leaf = categories.filter((c) => !categories.some((child) => child.parentId === c.id))
  function path(category: Category): string {
    const parent = categories.find((c) => c.id === category.parentId)
    return parent ? `${path(parent)} › ${category.name}` : category.name
  }
  async function request(body: unknown) {
    const response = await csrfFetch(`/api/admin/products/${productId}/category`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? data.message ?? 'Kategori değiştirilemedi.')
    return data.data ?? data
  }
  async function choose(id: string) {
    setTarget(id)
    setSchema(null)
    setError('')
    setBusy(true)
    try {
      const data = await request({ categoryId: id, preview: true })
      setSchema(data.schema)
      setValues(properties)
      setRows(variants)
      setUnit('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Şablon okunamadı.')
    } finally {
      setBusy(false)
    }
  }
  const axis = schema ? variantPropertyKey(schema, unit) : null
  function fieldInput(key: string, value: unknown, onChange: (value: string) => void, id: string) {
    if (!schema) return null
    const definition = schema.definitions.find((d) => d.key === key),
      binding = schema.config.fields.find((f) => f.key === key)
    if (!definition || !binding) return null
    const options =
      definition.kind === 'size'
        ? allowedSizeValues(schema, values.yas_grubu).map((v) => ({ id: v, label: v }))
        : definition.kind === 'boolean'
          ? [
              { id: 'true', label: 'Evet' },
              { id: 'false', label: 'Hayır' },
            ]
          : fieldOptions(schema, binding)
    return (
      <div className="space-y-1" key={id}>
        <Label htmlFor={id}>
          {definition.label}
          {definition.canonicalUnit && definition.canonicalUnit !== '—'
            ? ` (${definition.canonicalUnit})`
            : ''}
        </Label>
        {['select', 'boolean', 'size'].includes(definition.kind) ? (
          <select
            id={id}
            className="w-full rounded border bg-background p-2"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Seçin</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={id}
            type={definition.kind === 'number' ? 'number' : 'text'}
            step="any"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    )
  }
  async function save() {
    setError('')
    setBusy(true)
    try {
      const preview = await request({
        categoryId: target,
        contentUnit: unit || undefined,
        preview: true,
      })
      const detail = preview.removed.length
        ? ` Silinecek değerler: ${preview.removed.map((r: { key: string }) => r.key).join(', ')}.`
        : ''
      if (!window.confirm(`Ürünün kategorisi değiştirilecek.${detail} Devam edilsin mi?`)) return
      const visible = Object.fromEntries(
        Object.entries(values).filter(
          ([k]) =>
            schema?.config.fields.some((f) => f.key === k) &&
            (!rows.length || (k !== axis && !schema?.config.contentKeys.includes(k))),
        ),
      )
      await request({
        categoryId: target,
        properties: visible,
        variants: rows.map((r) => ({
          id: r.id,
          properties: axis ? { [axis]: r.properties[axis] ?? null } : {},
        })),
        ...(unit ? { contentUnit: unit } : {}),
        confirmationToken: preview.confirmationToken,
      })
      router.refresh()
      setSchema(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kategori değiştirilemedi.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="font-semibold">Kategori Değiştir</h2>
      <p className="text-sm text-muted-foreground">
        Yayımlanmış ürünlerde kategori değişikliğini admin yapar. Hedef kategorinin zorunlu
        özellikleri kaydetme sırasında denetlenir.
      </p>
      <select
        aria-label="Hedef kategori"
        className="w-full rounded border bg-background p-2"
        value={target}
        disabled={busy}
        onChange={(e) => void choose(e.target.value)}
      >
        <option value="">Kategori seçin</option>
        {leaf.map((c) => (
          <option key={c.id} value={c.id}>
            {path(c)}
          </option>
        ))}
      </select>
      {schema ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {schema.config.fields
              .filter(
                (f) =>
                  schema.definitions.find((d) => d.key === f.key)?.isActive !== false &&
                  (!rows.length || (f.key !== axis && !schema.config.contentKeys.includes(f.key))),
              )
              .map((f) =>
                fieldInput(
                  f.key,
                  values[f.key],
                  (value) =>
                    setValues({
                      ...values,
                      [f.key]:
                        schema.definitions.find((d) => d.key === f.key)?.kind === 'boolean'
                          ? value === ''
                            ? null
                            : value === 'true'
                          : value,
                    }),
                  `admin-property-${f.key}`,
                ),
              )}
          </div>
          {rows.length && schema.config.variantKey === 'net_icerik' ? (
            <div>
              <Label htmlFor="admin-content-unit">Net İçerik Birimi</Label>
              <select
                id="admin-content-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="">Seçin</option>
                {['ml', 'g', 'adet']
                  .filter((u) => variantPropertyKey(schema, u))
                  .map((u) => (
                    <option key={u}>{u}</option>
                  ))}
              </select>
            </div>
          ) : null}
          {rows.map((row) => (
            <div key={row.id} className="space-y-2 border-t pt-3">
              <p className="text-sm">{row.name}</p>
              {axis ? (
                fieldInput(
                  axis,
                  row.properties[axis],
                  (value) =>
                    setRows(
                      rows.map((r) =>
                        r.id === row.id ? { ...r, properties: { [axis]: value } } : r,
                      ),
                    ),
                  `admin-variant-${row.id}`,
                )
              ) : (
                <p className="text-sm">Hedef şablon için varyant alanı seçilmelidir.</p>
              )}
            </div>
          ))}
          <Button disabled={busy || target === categoryId} onClick={() => void save()}>
            Kategori Değişikliğini Kaydet
          </Button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}
