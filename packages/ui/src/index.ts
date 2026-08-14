/**
 * @hanuja/ui — Shared UI Component Library
 *
 * All components read colors from CSS custom properties (design tokens).
 * Client brand swap requires only updating :root CSS variables — no component changes needed.
 *
 * Base components: 21 | Composite components: 10
 */

// ── Utilities ──────────────────────────────────────────────────────────────
export { cn } from './lib/utils'

// ── Base Components ────────────────────────────────────────────────────────
export { Alert, type AlertProps } from './components/alert'
export { Avatar, type AvatarProps } from './components/avatar'
export { Badge, badgeVariants, type BadgeProps } from './components/badge'
export { Breadcrumb, type BreadcrumbItem, type BreadcrumbProps } from './components/breadcrumb'
export { Button, buttonVariants, type ButtonProps } from './components/button'
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/card'
export { Checkbox } from './components/checkbox'
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './components/dialog'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './components/dropdown-menu'
export { EmptyState, type EmptyStateProps } from './components/empty-state'
export { Input, type InputProps } from './components/input'
export { Label } from './components/label'
export { Pagination, type PaginationProps } from './components/pagination'
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from './components/select'
export { Separator } from './components/separator'
export { Skeleton } from './components/skeleton'
export { Spinner } from './components/spinner'
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabsProps,
  type TabsTriggerProps,
  type TabsContentProps,
} from './components/tabs'
export { Textarea, type TextareaProps } from './components/textarea'
export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
  Toaster,
  useToast,
  toast,
  type ToastProps,
  type ToastActionElement,
} from './components/toast'
export {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from './components/tooltip'

// ── Composite Components ───────────────────────────────────────────────────
export { DataTable, type Column, type DataTableProps } from './components/composite/data-table'
export { ProductCard, type ProductCardProps } from './components/composite/product-card'
export { SidebarNav, type NavItem, type NavSection, type SidebarNavProps } from './components/composite/sidebar-nav'
export { StatCard, type StatCardProps } from './components/composite/stat-card'
export { StatusBadge, getStatusLabel, type StatusBadgeProps } from './components/composite/status-badge'
export { FormField, type FormFieldProps } from './components/composite/form-field'
export { ConfirmDialog, type ConfirmDialogProps } from './components/composite/confirm-dialog'
export { PageHeader, type PageHeaderProps } from './components/composite/page-header'
export { FilterBar, type FilterChip, type FilterBarProps } from './components/composite/filter-bar'
export { ActionMenu, type ActionItem, type ActionMenuProps } from './components/composite/action-menu'
export { LegalDocumentDialog } from './components/composite/legal-document-dialog'
export { LegalDocumentHtml } from './components/composite/legal-document-html'
export {
  NotificationBell,
  type NotificationBellProps,
  type Notification,
} from './components/composite/notification-bell'
export {
  FileUpload,
  type FileUploadProps,
  type UploadedAsset,
  type UploadFolder,
} from './components/composite/file-upload'
export { TurnstileWidget, type TurnstileWidgetProps } from './components/turnstile-widget'

// ── Brand ──────────────────────────────────────────────────────────────────
export { HanujaLogo, type HanujaLogoProps } from './components/brand/hanuja-logo'

// ── Nav ────────────────────────────────────────────────────────────────────
export {
  MegaMenu,
  type MegaMenuProps,
  type MegaMenuItem,
  type MegaMenuColumn,
  type MegaMenuSubItem,
} from './components/nav/mega-menu'

// ── Storefront ─────────────────────────────────────────────────────────────
export { HeroSlider, type HeroSlide, type HeroSliderProps } from './components/hero-slider'
export { PromoCard, type PromoCardProps } from './components/promo-card'
export { isManagedMediaProxyUrl, mediaSrcSet, normalizeMediaDisplayUrl } from './lib/media-url'
