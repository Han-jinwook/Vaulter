import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin'
import { localNetlifyApi } from './scripts/vite-local-netlify-api.mjs'

export default defineConfig({
  // React 플러그인을 먼저 두면 HTML/모듈 파이프라인이 깨져 index.html 이 JS처럼
  // 파싱되는 import-analysis 오류를 줄인다 (@tailwindcss/vite 권장 순서 포함).
  // local-netlify-api 는 @netlify/vite-plugin 미들웨어보다 먼저 등록해야 /api 라우팅 충돌이 없음.
  plugins: [react(), tailwindcss(), localNetlifyApi(), netlify()],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },
})
