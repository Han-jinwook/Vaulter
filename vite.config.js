import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin'

export default defineConfig({
  plugins: [
    netlify(),
    tailwindcss(),
    react(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },
})
