/**
 * Loopback origins for server-to-server calls made by each panel to itself.
 *
 * These intentionally match the fixed `next start` ports in the panel
 * Dockerfiles. Do not derive this from request headers: public requests reach
 * Coolify over TLS while the Next server inside the container only serves HTTP.
 */
const INTERNAL_PANEL_ORIGINS = {
  seller: 'http://127.0.0.1:3001',
  admin: 'http://127.0.0.1:3002',
} as const

export type PanelName = keyof typeof INTERNAL_PANEL_ORIGINS

export function getPanelInternalOrigin(panel: PanelName): string {
  return INTERNAL_PANEL_ORIGINS[panel]
}
