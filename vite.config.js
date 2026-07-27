import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const additionalHosts = (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean)

const allowedHosts = [
  'localhost',
  '127.0.0.1',
  // Cloudflare Quick Tunnels receive a new subdomain on every launch.
  '.trycloudflare.com',
  ...additionalHosts,
]
const devPort = Number(process.env.E2E_WEB_PORT || 5173)
const apiPort = Number(process.env.E2E_API_PORT || 3001)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: devPort,
    strictPort: true,
    allowedHosts,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
