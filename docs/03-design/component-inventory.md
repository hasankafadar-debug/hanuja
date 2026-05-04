# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Component Inventory

Bu belge, `@hanuja/ui` paketindeki ortak component setini yuzey bazinda siniflar.
Kaynak: `packages/ui/src/index.ts`.

## Base components

- Alert
- Avatar
- Badge
- Breadcrumb
- Button
- Card
- Checkbox
- Dialog
- DropdownMenu
- EmptyState
- Input
- Label
- Pagination
- Select
- Separator
- Skeleton
- Spinner
- Tabs
- Textarea
- Toast
- Tooltip

## Composite components

- DataTable
- ProductCard
- SidebarNav
- StatCard
- StatusBadge
- FormField
- ConfirmDialog
- PageHeader
- FilterBar
- ActionMenu
- NotificationBell
- FileUpload

## Storefront agirlikli komponentler

- ProductCard
- Breadcrumb
- Pagination
- Tabs
- EmptyState

## Seller ve admin agirlikli komponentler

- SidebarNav
- DataTable
- StatusBadge
- PageHeader
- FilterBar
- ConfirmDialog
- ActionMenu

## Uygulama etkileri

- Yeni UI ihtiyaci cikarsa once mevcut component ailesine uyup uymadigi degerlendirilmelidir.
- Ayni probleme farkli yuzeylerde farkli adla ikinci bir component uretmek yerine ortak component genisletmesi tercih edilir.
