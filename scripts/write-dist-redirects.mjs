import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
fs.mkdirSync(dist, { recursive: true })
/**
 * netlify.toml 과 동일한 API → Functions 리라이트를 **여기에도** 먼저 둔다.
 * `/*` SPA 폴백만 있으면, 환경에 따라(병합/순서) /api가 index.html 쪽으로 잡혀
 * 채팅 fetch가 404·HTML이 될 수 있음.
 * SPA: netlify.toml에만 넣지 않는 이유 — 기존 주석( Vite+netlify dev 호환).
 */
const apiRedirects = [
  ['/api/analyze-receipt', '/.netlify/functions/analyze-receipt'],
  ['/api/analyze-email-receipt', '/.netlify/functions/analyze-email-receipt'],
  ['/api/analyze-document', '/.netlify/functions/analyze-document'],
  ['/api/chat-assistant', '/.netlify/functions/chat-assistant'],
  ['/api/chat-assistant-assets', '/.netlify/functions/chat-assistant-assets'],
  ['/api/chat-assistant-budget', '/.netlify/functions/chat-assistant-budget'],
  ['/api/chat-assistant-vault', '/.netlify/functions/chat-assistant-vault'],
  ['/api/vault-verify-pin', '/.netlify/functions/vault-verify-pin'],
  ['/api/webhook-receipt', '/.netlify/functions/webhook-receipt'],
  ['/api/webhook-ledger-pull', '/.netlify/functions/webhook-ledger-pull'],
  ['/api/webhook-auth-register', '/.netlify/functions/webhook-auth-register'],
  ['/api/auth/*', 'https://os.sundreamer.app/api/auth/:splat'],
  ['/api/wallet/*', 'https://os.sundreamer.app/api/wallet/:splat'],
  ['/api/payment/*', 'https://os.sundreamer.app/api/payment/:splat'],
]
  .map(([from, to]) => `${from}  ${to}  200`)
  .join('\n')

const body = `${apiRedirects}
# SPA: client-side routes (after API rules above)
/*  /index.html  200
`
fs.writeFileSync(path.join(dist, '_redirects'), body, 'utf8')
