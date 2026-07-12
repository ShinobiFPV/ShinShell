import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// § API versioning (§7) — read directly from the parent package.json at
// build time rather than an env var threaded through build:remote's shell
// invocation (which would need to work identically in PowerShell, bash,
// and CI) — this file already knows exactly where that package.json lives
// relative to itself. Falls back to 'dev' for `npm run dev` runs pointed
// at some other ShinShell instance during PWA-only iteration, where "which
// exact version" isn't a meaningful question.
const here = dirname(fileURLToPath(import.meta.url))
let shinshellVersion = 'dev'
try {
  const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf-8')) as { version?: string }
  shinshellVersion = pkg.version ?? 'dev'
} catch {
  // no parent package.json (e.g. this dir copied standalone) — 'dev' stands
}

// § ShinShell Remote PWA — fully separate from the desktop app's
// electron-vite config (which only recognizes main/preload/renderer
// targets). Built once via `npm run build`, then served as a static
// bundle by ShinShell's own remote server (see src/main/remote/server.ts's
// getPwaDistDir()) — this dev server (`npm run dev`) is only for iterating
// on the PWA's UI in isolation, pointed at a real ShinShell instance's
// Tailscale URL.
export default defineConfig({
  define: {
    __SHINSHELL_VERSION__: JSON.stringify(shinshellVersion)
  },
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'ShinShell Remote',
        short_name: 'ShinShell',
        description: 'Monitor and advance Claude Code sessions from your phone.',
        display: 'standalone',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  build: {
    // Keep the bundle tiny (§ Remote — "keep it small"): fail loudly if a
    // future dependency addition bloats it well past what a Preact + xterm
    // app should cost.
    chunkSizeWarningLimit: 400
  }
})
