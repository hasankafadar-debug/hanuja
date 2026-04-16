import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges Tailwind CSS classes safely, handling conflicts correctly.
 * Use this in all component className props.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
