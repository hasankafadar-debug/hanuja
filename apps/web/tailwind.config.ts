import type { Config } from 'tailwindcss'
import { hanujaPreset } from '@hanuja/config/tailwind/preset'

const config: Config = {
  presets: [hanujaPreset],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
}

export default config
