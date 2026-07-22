'use client'

import { useEffect, useMemo, useState } from 'react'
import { Breadcrumb, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@hanuja/ui'
import {
  buildChildrenMap,
  getAncestorPath,
  isLeafCategory,
  type CategoryNode,
} from '../_lib/category-tree'

interface CategoryPickerProps {
  categories: CategoryNode[]
  value: string
  onChange: (categoryId: string) => void
  disabled?: boolean
}

/**
 * Cascading category selector: one Select per tree level. Selecting a
 * non-leaf category clears `value` (and any deeper levels) so the existing
 * "kategori zorunlu" validation in the product forms keeps working
 * unchanged — only a leaf category id is ever reported via `onChange`.
 */
export default function CategoryPicker({ categories, value, onChange, disabled }: CategoryPickerProps) {
  const childrenMap = useMemo(() => buildChildrenMap(categories), [categories])
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  // `selectedIds[i]` is the chosen category id at level i (root = 0).
  const [selectedIds, setSelectedIds] = useState<string[]>(() => getAncestorPath(value, categories))

  useEffect(() => {
    // An empty `value` is how this component reports "no leaf chosen yet" while
    // the seller is still drilling down, so it must not wipe the levels already
    // opened. Only a real, externally-set id re-derives the path.
    if (!value) return

    const path = getAncestorPath(value, categories)

    // A product saved before the leaf-only rule — or one whose category was
    // deactivated since — carries a value this picker cannot represent. Report it
    // as unselected so the form blocks submission and the seller drills down
    // again, instead of letting the save fail server-side.
    if (path.length === 0 || !isLeafCategory(value, categories)) {
      onChange('')
      return
    }

    setSelectedIds((current) => (current[current.length - 1] === value ? current : path))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const levels: CategoryNode[][] = []
  let parentId: string | null = null
  for (const selectedId of selectedIds) {
    const options = childrenMap.get(parentId) ?? []
    if (options.length === 0) break
    levels.push(options)
    parentId = selectedId
  }
  // Always show the next open level (root level, or the children of the
  // deepest selection) so the seller can keep drilling down.
  const nextLevelOptions = childrenMap.get(parentId) ?? []
  if (nextLevelOptions.length > 0) levels.push(nextLevelOptions)

  function handleLevelChange(levelIndex: number, categoryId: string) {
    const nextSelectedIds = [...selectedIds.slice(0, levelIndex), categoryId]
    setSelectedIds(nextSelectedIds)

    if (isLeafCategory(categoryId, categories)) {
      onChange(categoryId)
    } else {
      onChange('')
    }
  }

  const selectedPath = selectedIds
    .map((id) => categoryMap.get(id))
    .filter((node): node is CategoryNode => Boolean(node))

  return (
    <div className="space-y-3">
      {levels.map((options, levelIndex) => (
        <div key={levelIndex} className="space-y-1.5">
          <Label htmlFor={`category-level-${levelIndex}`}>
            {levelIndex === 0 ? 'Kategori *' : 'Alt kategori *'}
          </Label>
          <Select
            onValueChange={(categoryId) => handleLevelChange(levelIndex, categoryId)}
            value={selectedIds[levelIndex] ?? ''}
          >
            <SelectTrigger
              id={`category-level-${levelIndex}`}
              aria-label={levelIndex === 0 ? 'Kategori' : 'Alt kategori'}
              disabled={disabled}
            >
              <SelectValue placeholder="Kategori secin" />
            </SelectTrigger>
            <SelectContent>
              {options.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}

      {selectedPath.length > 0 && (
        <Breadcrumb items={selectedPath.map((node) => ({ label: node.name }))} />
      )}
    </div>
  )
}
