import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// `npm run dev` serves this computer only over HTTP.
// `npm run dev:lan` (mode "lan") serves the local network over HTTPS with a self-signed
// certificate: other devices need a secure context for the microphone, crypto.randomUUID
// and SHA-256 duplicate detection, none of which work on plain http://192.168.x.x.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'lan' ? [basicSsl({ name: 'personal-world' })] : [])],
  server: {
    host: mode === 'lan' ? '0.0.0.0' : '127.0.0.1',
    port: 5183,
    strictPort: true,
    // Photos and test media are not source: copying a large photo into data/ while it is
    // still locked made the watcher crash the dev server (EBUSY on Windows)
    watch: { ignored: ['**/data/**', '**/server/data/**', '**/skills/**/evals/**', '**/tests/fixtures/**', '**/docs/**', '**/public/earth-cartoon.svg'] },
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/_AMapService': 'http://127.0.0.1:8787',
    },
  },
}))
