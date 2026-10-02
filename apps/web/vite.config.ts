import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local only: DEV_API_PROXY (e.g. http://localhost:8081) and DEV_MEDIA_PROXY (e.g.
// http://localhost:9002) make the dev server serve /api and /ceitba-media like Caddy
// does in prod, so the page, the API and signed storage URLs share one origin.
// The Host header is kept so storage signatures made for this origin still verify.
const apiProxy = process.env.DEV_API_PROXY
const mediaProxy = process.env.DEV_MEDIA_PROXY

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH ?? '/',
  build: {
    // The largest chunk is SheetJS (~500 kB), which only loads when someone
    // opens a spreadsheet in Apuntes; the main bundle stays far below this.
    chunkSizeWarningLimit: 600,
  },
  server: {
    proxy: {
      ...(apiProxy ? { '/api': { target: apiProxy } } : {}),
      ...(mediaProxy ? { '/ceitba-media': { target: mediaProxy } } : {}),
    },
  },
})
