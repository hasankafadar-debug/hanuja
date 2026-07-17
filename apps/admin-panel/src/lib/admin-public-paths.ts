const PUBLIC_ADMIN_PATHS = new Set(['/giris', '/sifremi-unuttum', '/sifre-sifirla'])

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.has(pathname)
}
