const PUBLIC_ADMIN_PATHS = new Set(['/giris', '/iki-asamali-dogrulama', '/sifremi-unuttum', '/sifre-sifirla'])

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.has(pathname)
}
