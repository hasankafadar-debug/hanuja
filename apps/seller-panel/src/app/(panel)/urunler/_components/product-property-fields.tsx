'use client'

import { Input, Label } from '@hanuja/ui'
import {
  allowedSizeValues,
  fieldOptions,
  variantPropertyKey,
  canonicalNumber,
  type ResolvedCategorySchema,
  type ProductProperties,
  type PropertyValue,
} from '@hanuja/api/domain/category-schema'

export function PropertyInput({
  schema,
  fieldKey,
  value,
  onChange,
  age,
  required = false,
  disabled = false,
  idPrefix = 'property',
}: {
  schema: ResolvedCategorySchema
  fieldKey: string
  value: PropertyValue | undefined
  onChange: (value: PropertyValue) => void
  age?: unknown
  required?: boolean
  disabled?: boolean
  idPrefix?: string
}) {
  const field = schema.config.fields.find((f) => f.key === fieldKey)
  const definition = schema.definitions.find((f) => f.key === fieldKey)
  if (!definition || !field) return null
  const id = `${idPrefix}-${fieldKey}`
  const options =
    definition.kind === 'size'
      ? allowedSizeValues(schema, age).map((v) => ({ id: v, label: v, isActive: true }))
      : fieldOptions(schema, field)
  const label = definition.key === 'cinsiyet' ? 'Cinsiyet (Kadın / Kız)' : definition.label
  const displayUnit = field.displayUnit ?? definition.canonicalUnit
  const scale =
    definition.kind === 'number' && displayUnit
      ? canonicalNumber(definition, `1 ${displayUnit}`)
      : 1
  const displayValue =
    definition.kind === 'number' && value !== undefined && value !== null && value !== ''
      ? String(Number(value) / scale)
      : value === undefined || value === null
        ? ''
        : String(value)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {displayUnit && displayUnit !== '—' ? ` (${displayUnit})` : ''}
        {required ? ' *' : ''}
      </Label>
      {definition.kind === 'select' ||
      definition.kind === 'size' ||
      definition.kind === 'boolean' ? (
        <select
          id={id}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
          style={{ borderColor: 'var(--color-border)' }}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : definition.kind === 'boolean'
                  ? e.target.value === 'true'
                  : e.target.value,
            )
          }
          required={required}
          disabled={disabled}
        >
          <option value="">Seçin</option>
          {definition.kind === 'boolean' ? (
            <>
              <option value="true">Evet</option>
              <option value="false">Hayır</option>
            </>
          ) : (
            options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))
          )}
          {value !== undefined &&
          value !== null &&
          value !== '' &&
          definition.kind !== 'boolean' &&
          !options.some((o) => o.id === String(value)) ? (
            <option value={String(value)}>
              {definition.config.options?.find((o) => o.id === value)?.label ?? String(value)}{' '}
              (mevcut değer)
            </option>
          ) : null}
        </select>
      ) : (
        <Input
          id={id}
          value={displayValue}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : definition.kind === 'number'
                  ? Number(e.target.value) * scale
                  : e.target.value,
            )
          }
          required={required}
          disabled={disabled}
          type={definition.kind === 'number' ? 'number' : 'text'}
          step={definition.config.integer ? '1' : 'any'}
          min={definition.kind === 'number' && fieldKey !== 'konfor_sicakligi_c' ? '0' : undefined}
        />
      )}
    </div>
  )
}

export function ProductPropertyFields({
  schema,
  values,
  onChange,
  hasVariants,
  contentUnit,
  setContentUnit,
  editing = false,
  initialValues = {},
  disabled = false,
  contentUnitLocked = false,
}: {
  schema: ResolvedCategorySchema | null
  values: ProductProperties
  onChange: (values: ProductProperties) => void
  hasVariants: boolean
  contentUnit: string
  setContentUnit: (unit: string) => void
  editing?: boolean
  initialValues?: ProductProperties
  disabled?: boolean
  contentUnitLocked?: boolean
}) {
  if (!schema) return null
  const key = variantPropertyKey(schema, contentUnit)
  const excluded = hasVariants
    ? schema.config.variantKey === 'net_icerik'
      ? schema.config.contentKeys
      : key
        ? [key]
        : []
    : []
  return (
    <section className="space-y-4" aria-label="Ürün Özellikleri">
      <h2 className="text-base font-semibold">Ürün Özellikleri</h2>
      {schema.config.variantKey === 'net_icerik' && hasVariants ? (
        <div className="space-y-1.5">
          <Label htmlFor="content-unit">Net İçerik Birimi *</Label>
          <select
            id="content-unit"
            value={contentUnit}
            onChange={(e) => setContentUnit(e.target.value)}
            className="h-10 rounded-md border bg-transparent px-3"
            required
            disabled={disabled || contentUnitLocked}
          >
            <option value="">Seçin</option>
            {schema.config.contentKeys
              .map((k) => ({ hacim_ml: 'ml', net_agirlik_g: 'g', paket_adedi: 'adet' })[k])
              .filter(Boolean)
              .map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
          </select>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {schema.config.fields
          .filter((f) => !excluded.includes(f.key))
          .map((field) => (
            <PropertyInput
              key={field.key}
              schema={schema}
              fieldKey={field.key}
              value={values[field.key]}
              age={values.yas_grubu}
              onChange={(value) => onChange({ ...values, [field.key]: value })}
              required={
                field.required &&
                (!editing ||
                  (initialValues[field.key] !== undefined &&
                    initialValues[field.key] !== null &&
                    initialValues[field.key] !== ''))
              }
              disabled={disabled}
            />
          ))}
      </div>
      {schema.config.requiredGroups
        .filter((g) => g.keys.some((k) => !excluded.includes(k)))
        .map((group) => (
          <p key={group.label} className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {group.label}:{' '}
            {group.keys.map((k) => schema.definitions.find((f) => f.key === k)?.label).join(', ')}{' '}
            alanlarından en az birini doldurun.
          </p>
        ))}
      {schema.templateCode === 'BEB-BEZ' ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Paket adedi bütün numaralarda aynı olmalıdır. Farklı adetli paketleri ayrı ürün olarak
          ekleyin.
        </p>
      ) : null}
    </section>
  )
}
