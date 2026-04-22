import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin'
import { localNetlifyApi } from './scripts/vite-local-netlify-api.mjs'

export default defineConfig({
  // Netlify 미들웨어보다 먼저 chat API를 잡아 순수 `vite`에서도 함수가 동작하도록
  plugins: [localNetlifyApi(), netlify(), tailwindcss(), react()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },
})
