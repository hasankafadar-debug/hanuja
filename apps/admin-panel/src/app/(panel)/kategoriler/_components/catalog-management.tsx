'use client'
import { csrfFetch } from '@/lib/csrf-fetch'
import { useEffect, useState } from 'react'
import { Button, Input, Label } from '@hanuja/ui'
import { normalizeSlug } from '@hanuja/api/domain/slug'
import type {
  CatalogFieldDefinition,
  TemplateConfig,
  TemplateField,
} from '@hanuja/api/domain/category-schema'
type Category = {
  id: string
  name: string
  slug: string
  parentId: string | null
  sortOrder: number
  templateCode: string | null
  maxInstallmentCount: number | null
}
type Template = {
  code: string
  label: string
  compatibilityVersion: number
  config: TemplateConfig
}
type Field = CatalogFieldDefinition & { everUsed?: boolean }
async function request(url: string, body?: unknown) {
  const response = await csrfFetch(
    url,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  )
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.message ?? result.error ?? 'İşlem tamamlanamadı. Alanları kontrol edin.')
  return result.data ?? result
}
const selectClass = 'h-10 w-full rounded-md border bg-transparent px-3 text-sm'
const emptyConfig: TemplateConfig = {
  fields: [],
  requiredGroups: [],
  variantKey: null,
  variantLabel: null,
  contentKeys: [],
  shared: { color: true, material: true, dimensions: false },
  materialLabels: [],
}
export default function CatalogManagement() {
  const [categories, setCategories] = useState<Category[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [fields, setFields] = useState<Field[]>([])
  const [tab, setTab] = useState('categories'),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [category, setCategory] = useState({
    id: '',
    name: '',
    parentId: '',
    templateCode: '',
    sortOrder: 0,
  })
  const [template, setTemplate] = useState<Template>({
    code: '',
    label: '',
    compatibilityVersion: 1,
    config: emptyConfig,
  })
  const [field, setField] = useState<Field>({
    key: '',
    label: '',
    kind: 'text',
    canonicalUnit: null,
    config: {},
  })
  const [newOption, setNewOption] = useState(''),
    [sizeValue, setSizeValue] = useState(''),
    [sizeSubset, setSizeSubset] = useState('B1'),
    [newTemplateField, setNewTemplateField] = useState('')
  const [installmentLimit, setInstallmentLimit] = useState('')
  async function reload() {
    const [c, s] = await Promise.all([
      request('/api/admin/categories'),
      request('/api/admin/catalog-schema'),
    ])
    setCategories(c.categories)
    setTemplates(s.templates)
    setFields(s.fields)
  }
  useEffect(() => {
    reload().catch((e) => setError(e.message))
  }, [])
  const path = (c: Category) => {
    const names = [c.name]
    let p = c.parentId
    const seen = new Set<string>()
    while (p && !seen.has(p)) {
      seen.add(p)
      const parent = categories.find((n) => n.id === p)
      if (!parent) break
      names.unshift(parent.name)
      p = parent.parentId
    }
    return names.join(' / ')
  }
  async function execute(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      await reload()
      setMessage('Kaydedildi.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally {
      setBusy(false)
    }
  }
  async function saveCategory() {
    await execute(async () => {
      const body = {
        ...(category.id ? { id: category.id } : {}),
        name: category.name,
        parentId: category.parentId || null,
        templateCode: category.templateCode || null,
        sortOrder: category.sortOrder,
      }
      const preview = await request('/api/admin/categories', { ...body, preview: true })
      if (
        preview.affectedProducts &&
        !window.confirm(
          `${preview.affectedProducts} ürünün şablonu değişecek. Özellik değerleri saklanacak. Devam edilsin mi?`,
        )
      )
        return
      await request('/api/admin/categories', {
        ...body,
        confirmationToken: preview.confirmationToken,
      })
      setCategory({ id: '', name: '', parentId: '', templateCode: '', sortOrder: 0 })
    })
  }
  async function saveTemplate() {
    await execute(async () => {
      const body = { type: 'template', ...template }
      const preview = await request('/api/admin/catalog-schema', { ...body, preview: true })
      if (
        preview.affectedProducts &&
        !window.confirm(
          `${preview.affectedProducts} ürün etkileniyor.${preview.optionUsage ? ` Pasifleştirilen seçenek ${preview.optionUsage} üründe kullanılıyor.` : ''}${preview.incompatible ? ' Bu şablonun eski Excel dosyaları geçersiz olacak.' : ''} Ürün değerleri saklanacak. Devam edilsin mi?`,
        )
      )
        return
      await request('/api/admin/catalog-schema', {
        ...body,
        confirmationToken: preview.confirmationToken,
      })
    })
  }
  /** Taksit üst sınırı: boş bırakılırsa üst kategoriden devralınır (zincir boşsa sınır yok). */
  async function saveInstallmentLimit() {
    if (!category.id) return
    await execute(async () => {
      const trimmed = installmentLimit.trim()
      const value = trimmed === '' ? null : Number(trimmed)
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 36)) {
        throw new Error('Taksit sınırı 1 ile 36 arasında tam sayı olmalı veya boş bırakılmalı.')
      }
      const response = await csrfFetch(`/api/admin/categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxInstallmentCount: value }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message ?? 'Taksit sınırı kaydedilemedi.')
    })
  }
  const updateBinding = (key: string, patch: Partial<TemplateField>) =>
    setTemplate((t) => ({
      ...t,
      config: {
        ...t.config,
        fields: t.config.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
      },
    }))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {[
          ['categories', 'Kategoriler'],
          ['templates', 'Şablonlar'],
          ['fields', 'Özellikler ve Seçenekler'],
        ].map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? 'default' : 'outline'}
            onClick={() => {
              setTab(value!)
              setError('')
              setMessage('')
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm" style={{ color: 'var(--color-success)' }}>
          {message}
        </p>
      ) : null}
      {tab === 'categories' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <Input
              aria-label="Kategori ara"
              placeholder="Kategori ara"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-[650px] space-y-1 overflow-auto">
              {categories
                .filter((c) =>
                  path(c).toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')),
                )
                .map((c) => (
                  <button
                    key={c.id}
                    className="block w-full rounded border px-3 py-2 text-left text-sm hover:bg-[var(--color-muted)]"
                    onClick={() => {
                      setCategory({
                        id: c.id,
                        name: c.name,
                        parentId: c.parentId ?? '',
                        templateCode: c.templateCode ?? '',
                        sortOrder: c.sortOrder,
                      })
                      setInstallmentLimit(
                        c.maxInstallmentCount === null ? '' : String(c.maxInstallmentCount),
                      )
                    }}
                  >
                    {path(c)}
                  </button>
                ))}
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void saveCategory()
            }}
          >
            <h2 className="font-semibold">{category.id ? 'Kategori Düzenle' : 'Kategori Ekle'}</h2>
            <div className="space-y-1.5">
              <Label htmlFor="category-name">Kategori Adı *</Label>
              <Input
                id="category-name"
                value={category.name}
                onChange={(e) => setCategory({ ...category, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-parent">Üst Kategori</Label>
              <select
                id="category-parent"
                className={selectClass}
                disabled={Boolean(category.id)}
                value={category.parentId}
                onChange={(e) => setCategory({ ...category, parentId: e.target.value })}
              >
                <option value="">Ana kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {path(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-template">Ürün Şablonu</Label>
              <select
                id="category-template"
                className={selectClass}
                value={category.templateCode}
                onChange={(e) => setCategory({ ...category, templateCode: e.target.value })}
                required={!category.parentId}
              >
                <option value="">Üst kategoriden al</option>
                {templates.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category-order">Sıra</Label>
              <Input
                id="category-order"
                type="number"
                min="0"
                value={category.sortOrder}
                onChange={(e) => setCategory({ ...category, sortOrder: Number(e.target.value) })}
              />
            </div>
            {category.id ? (
              <div className="space-y-1.5 rounded-md border p-3">
                <Label htmlFor="category-installment-limit">Taksit üst sınırı</Label>
                <div className="flex gap-2">
                  <Input
                    id="category-installment-limit"
                    type="number"
                    min="1"
                    max="36"
                    placeholder="Üst kategoriden"
                    value={installmentLimit}
                    onChange={(e) => setInstallmentLimit(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void saveInstallmentLimit()}
                  >
                    Kaydet
                  </Button>
                </div>
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  Boş bırakılırsa üst kategorinin sınırı geçerli olur; hiçbirinde yoksa iyzico&apos;nun
                  sunduğu tüm taksitler gösterilir. Sepette en düşük sınır uygulanır.
                </p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button disabled={busy}>Kaydet</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setCategory({
                    id: '',
                    name: '',
                    parentId: '',
                    templateCode: '',
                    sortOrder: categories.filter((c) => !c.parentId).length,
                  })
                }
              >
                Yeni Kategori
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {tab === 'templates' ? (
        <div className="space-y-5 max-w-4xl">
          <select
            aria-label="Şablon seç"
            className={selectClass}
            value={template.code}
            onChange={(e) => {
              const t = templates.find((t) => t.code === e.target.value)
              if (t) setTemplate(structuredClone(t))
            }}
          >
            <option value="">Şablon seçin</option>
            {templates.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label} — sürüm {t.compatibilityVersion}
              </option>
            ))}
          </select>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="template-code">Şablon Kodu *</Label>
              <Input
                id="template-code"
                value={template.code}
                disabled={templates.some((t) => t.code === template.code)}
                onChange={(e) => setTemplate({ ...template, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Label htmlFor="template-label">Şablon Adı *</Label>
              <Input
                id="template-label"
                value={template.label}
                onChange={(e) => setTemplate({ ...template, label: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {(['color', 'material', 'dimensions'] as const).map((key) => (
              <label key={key} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={template.config.shared[key]}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      config: {
                        ...template.config,
                        shared: { ...template.config.shared, [key]: e.target.checked },
                      },
                    })
                  }
                />
                {{ color: 'Renk', material: 'Materyal', dimensions: 'En / Boy / Yükseklik' }[key]}{' '}
                göster
              </label>
            ))}
          </div>
          <div>
            <Label htmlFor="template-variant">Varyant Alanı</Label>
            <select
              id="template-variant"
              className={selectClass}
              value={template.config.variantKey ?? ''}
              onChange={(e) =>
                setTemplate({
                  ...template,
                  config: {
                    ...template.config,
                    variantKey: e.target.value || null,
                    variantLabel:
                      fields.find((f) => f.key === e.target.value)?.label ??
                      (e.target.value === 'net_icerik' ? 'Net İçerik' : null),
                  },
                })
              }
            >
              <option value="">Varyant yok</option>
              {template.config.fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {fields.find((d) => d.key === f.key)?.label}
                </option>
              ))}
              {template.config.contentKeys.length ? (
                <option value="net_icerik">Net İçerik</option>
              ) : null}
            </select>
          </div>
          <div className="space-y-2">
            {template.config.fields.map((f) => (
              <div key={f.key} className="flex flex-wrap items-center gap-3 border-b py-2">
                <span className="min-w-44 text-sm">
                  {fields.find((d) => d.key === f.key)?.label}
                </span>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateBinding(f.key, { required: e.target.checked })}
                  />
                  Zorunlu
                </label>
                {fields.find((d) => d.key === f.key)?.kind === 'number' ? (
                  <Input
                    className="max-w-32"
                    aria-label={`${f.key} gösterim birimi`}
                    placeholder="Gösterim birimi"
                    value={f.displayUnit ?? ''}
                    onChange={(e) => updateBinding(f.key, { displayUnit: e.target.value })}
                  />
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setTemplate({
                      ...template,
                      config: {
                        ...template.config,
                        fields: template.config.fields.filter((x) => x.key !== f.key),
                        requiredGroups: template.config.requiredGroups
                          .map((g) => ({ ...g, keys: g.keys.filter((k) => k !== f.key) }))
                          .filter((g) => g.keys.length),
                      },
                    })
                  }
                >
                  Alanı Kaldır
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <select
              className={selectClass}
              aria-label="Şablona alan ekle"
              value={newTemplateField}
              onChange={(e) => setNewTemplateField(e.target.value)}
            >
              <option value="">Alan seçin</option>
              {fields
                .filter((f) => !template.config.fields.some((t) => t.key === f.key))
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
            <Button
              variant="outline"
              disabled={!newTemplateField}
              onClick={() => {
                setTemplate({
                  ...template,
                  config: {
                    ...template.config,
                    fields: [...template.config.fields, { key: newTemplateField, required: false }],
                  },
                })
                setNewTemplateField('')
              }}
            >
              Alan Ekle
            </Button>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Grup Zorunlulukları</legend>
            {template.config.requiredGroups.map((group, index) => (
              <div key={index} className="space-y-2 border p-3">
                <Input
                  aria-label="Grup adı"
                  value={group.label}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      config: {
                        ...template.config,
                        requiredGroups: template.config.requiredGroups.map((g, i) =>
                          i === index ? { ...g, label: e.target.value } : g,
                        ),
                      },
                    })
                  }
                />
                <div className="flex flex-wrap gap-3">
                  {template.config.fields.map((f) => (
                    <label key={f.key} className="flex gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={group.keys.includes(f.key)}
                        onChange={(e) =>
                          setTemplate({
                            ...template,
                            config: {
                              ...template.config,
                              requiredGroups: template.config.requiredGroups.map((g, i) =>
                                i === index
                                  ? {
                                      ...g,
                                      keys: e.target.checked
                                        ? [...g.keys, f.key]
                                        : g.keys.filter((k) => k !== f.key),
                                    }
                                  : g,
                              ),
                            },
                          })
                        }
                      />
                      {fields.find((d) => d.key === f.key)?.label}
                    </label>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setTemplate({
                      ...template,
                      config: {
                        ...template.config,
                        requiredGroups: template.config.requiredGroups.filter(
                          (_, i) => i !== index,
                        ),
                      },
                    })
                  }
                >
                  Grubu Kaldır
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setTemplate({
                  ...template,
                  config: {
                    ...template.config,
                    requiredGroups: [
                      ...template.config.requiredGroups,
                      { label: 'Yeni grup', keys: [] },
                    ],
                  },
                })
              }
            >
              Grup Ekle
            </Button>
          </fieldset>
          <div className="flex gap-2">
            <Button
              disabled={busy || !template.code || !template.label}
              onClick={() => void saveTemplate()}
            >
              Şablonu Kaydet
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setTemplate({
                  code: '',
                  label: '',
                  compatibilityVersion: 1,
                  config: structuredClone(emptyConfig),
                })
              }
            >
              Yeni Şablon
            </Button>
          </div>
        </div>
      ) : null}
      {tab === 'fields' ? (
        <div className="max-w-3xl space-y-4">
          <select
            aria-label="Özellik seç"
            className={selectClass}
            value={field.key}
            onChange={(e) => {
              const f = fields.find((f) => f.key === e.target.value)
              if (f) setField(structuredClone(f))
            }}
          >
            <option value="">Özellik seçin</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="field-label">Özellik Adı *</Label>
              <Input
                id="field-label"
                value={field.label}
                onChange={(e) =>
                  setField({
                    ...field,
                    label: e.target.value,
                    ...(!fields.some((f) => f.key === field.key)
                      ? { key: normalizeSlug(e.target.value).replace(/-/g, '_') }
                      : {}),
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="field-kind">Alan Türü</Label>
              <select
                id="field-kind"
                className={selectClass}
                value={field.kind}
                disabled={field.everUsed}
                onChange={(e) => setField({ ...field, kind: e.target.value })}
              >
                {[
                  ['text', 'Metin'],
                  ['select', 'Seçenek Listesi'],
                  ['number', 'Sayı'],
                  ['boolean', 'Evet / Hayır'],
                  ['size', 'Beden Sözlüğü'],
                ].map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {field.kind === 'number' ? (
            <div className="space-y-2">
              <Label htmlFor="field-unit">Kanonik Birim</Label>
              <Input
                id="field-unit"
                value={field.canonicalUnit ?? ''}
                disabled={field.everUsed}
                onChange={(e) => setField({ ...field, canonicalUnit: e.target.value || null })}
              />
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.config.integer ?? false}
                  onChange={(e) =>
                    setField({ ...field, config: { ...field.config, integer: e.target.checked } })
                  }
                />
                Yalnız tam sayı
              </label>
              {field.everUsed ? (
                <p className="text-sm">
                  Kullanılmış alanın birimi sabittir. Gösterim birimini şablondan
                  değiştirebilirsiniz.
                </p>
              ) : null}
            </div>
          ) : null}
          {field.kind === 'select' ? (
            <div className="space-y-2">
              {(field.config.options ?? []).map((o, index) => (
                <div key={o.id} className="flex items-center gap-3">
                  <Input
                    aria-label={`Seçenek ${index + 1}`}
                    value={o.label}
                    onChange={(e) =>
                      setField({
                        ...field,
                        config: {
                          ...field.config,
                          options: (field.config.options ?? []).map((v, i) =>
                            i === index ? { ...v, label: e.target.value } : v,
                          ),
                        },
                      })
                    }
                  />
                  <label className="flex shrink-0 gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={o.isActive}
                      onChange={(e) =>
                        setField({
                          ...field,
                          config: {
                            ...field.config,
                            options: (field.config.options ?? []).map((v, i) =>
                              i === index ? { ...v, isActive: e.target.checked } : v,
                            ),
                          },
                        })
                      }
                    />
                    Aktif
                  </label>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  aria-label="Yeni seçenek"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!newOption.trim()}
                  onClick={() => {
                    setField({
                      ...field,
                      config: {
                        ...field.config,
                        options: [
                          ...(field.config.options ?? []),
                          { id: normalizeSlug(newOption), label: newOption.trim(), isActive: true },
                        ],
                      },
                    })
                    setNewOption('')
                  }}
                >
                  Seçenek Ekle
                </Button>
              </div>
            </div>
          ) : null}
          {field.kind === 'size' ? (
            <div className="space-y-2">
              <select
                aria-label="Beden alt kümesi"
                className={selectClass}
                value={sizeSubset}
                onChange={(e) => setSizeSubset(e.target.value)}
              >
                {Object.keys(field.config.subsets ?? {}).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <p className="text-sm">{field.config.subsets?.[sizeSubset]?.join(' · ')}</p>
              <div className="flex gap-2">
                <Input
                  aria-label="Yeni beden değeri"
                  value={sizeValue}
                  onChange={(e) => setSizeValue(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={!sizeValue.trim()}
                  onClick={() => {
                    setField({
                      ...field,
                      config: {
                        ...field.config,
                        subsets: {
                          ...field.config.subsets,
                          [sizeSubset]: Array.from(
                            new Set([
                              ...(field.config.subsets?.[sizeSubset] ?? []),
                              sizeValue.trim(),
                            ]),
                          ),
                        },
                      },
                    })
                    setSizeValue('')
                  }}
                >
                  Beden Ekle
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              disabled={busy || !field.key || !field.label}
              onClick={() =>
                void execute(async () => {
                  const body = { type: 'field', ...field }
                  const preview = await request('/api/admin/catalog-schema', {
                    ...body,
                    preview: true,
                  })
                  if (
                    preview.affectedProducts &&
                    !window.confirm(
                      `${preview.affectedProducts} ürün etkileniyor.${preview.optionUsage ? ` Pasifleştirilen seçenek ${preview.optionUsage} üründe kullanılıyor.` : ''}${preview.incompatible ? ' Eski Excel dosyaları yenilenmelidir.' : ''} Değerler saklanacak. Devam edilsin mi?`,
                    )
                  )
                    return
                  await request('/api/admin/catalog-schema', {
                    ...body,
                    confirmationToken: preview.confirmationToken,
                  })
                })
              }
            >
              Özelliği Kaydet
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setField({ key: '', label: '', kind: 'text', canonicalUnit: null, config: {} })
              }
            >
              Yeni Özellik
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
