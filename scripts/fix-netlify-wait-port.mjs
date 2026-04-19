import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'node_modules', 'netlify-cli', 'dist', 'utils', 'framework-server.js')
if (!fs.existsSync(target)) {
  process.exit(0)
}
let s = fs.readFileSync(target, 'utf8')
const bad =
  "settings.frameworkPort, 'localhost', FRAMEWORK_PORT_TIMEOUT_MS, 20);"
const good = "settings.frameworkPort, 'localhost', FRAMEWORK_PORT_TIMEOUT_MS);"
if (s.includes(bad)) {
  s = s.replace(bad, good)
  fs.writeFileSync(target, s)
  console.log('[postinstall] netlify-cli: waitPort uses timeout-based retries (5173 slow-start fix)')
}
