import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// § ShinShell Remote PWA — fully separate from the desktop app's
// electron-vite config (which only recognizes main/preload/renderer
// targets). Built once via `npm run build`, then served as a static
// bundle by ShinShell's own remote server (see src/main/remote/server.ts's
// getPwaDistDir()) — this dev server (`npm run dev`) is only for iterating
// on the PWA's UI in isolation, pointed at a real ShinShell instance's
// Tailscale URL.
export default defineConfig({
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
