/** Attach the panel's double-submit token only to requests on the current origin. */
export function csrfHeaders(apiPath: string): Headers {
  const headers = new Headers()
  if (
    typeof window === 'undefined' ||
    new URL(apiPath, window.location.origin).origin !== window.location.origin
  )
    return headers
  const token = document.cookie
    .split('; ')
    .find((row) => row.startsWith('hanuja-csrf-mirror='))
    ?.split('=')[1]
  if (token) headers.set('x-csrf-token', decodeURIComponent(token))
  return headers
}
