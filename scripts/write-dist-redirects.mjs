import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
fs.mkdirSync(dist, { recursive: true })
// SPA fallback for Netlify production only (not in netlify.toml — that breaks `netlify dev` + Vite)
fs.writeFileSync(path.join(dist, '_redirects'), '/*    /index.html   200\n')
