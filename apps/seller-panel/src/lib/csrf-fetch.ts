'use client'
export function csrfFetch(url: string, init: RequestInit = {}) {
  const token = document.cookie.split('; ').find((row) => row.startsWith('hanuja-csrf-mirror='))?.split('=')[1]
  const headers = new Headers(init.headers)
  if (token) headers.set('x-csrf-token', token)
  return fetch(url, { ...init, headers })
}
