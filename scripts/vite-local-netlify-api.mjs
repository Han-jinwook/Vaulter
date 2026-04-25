/**
 * 순수 `vite` 개발 시 @netlify/vite-plugin 이 일부 /api 경로를 404로 둘 때,
 * chat용 Netlify 함수를 Node에서 직접 로드해 응답한다. (프로덕션/ netlify dev 는 기존 동작)
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const ROUTES = {
  '/api/chat-assistant': 'chat-assistant.js',
  '/api/chat-assistant-assets': 'chat-assistant-assets.js',
  '/api/chat-assistant-budget': 'chat-assistant-budget.js',
  '/api/chat-assistant-vault': 'chat-assistant-vault.js',
  '/api/vault-verify-pin': 'vault-verify-pin.js',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const fnCache = new Map()

export function localNetlifyApi() {
  return {
    name: 'local-netlify-api',
    configureServer(server) {
      const root = server.config.root
      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0]
        const file = ROUTES[pathOnly]
        if (!file) return next()

        const baseHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        }
        if (req.method === 'OPTIONS') {
          for (const [k, v] of Object.entries(baseHeaders)) {
            res.setHeader(k, v)
          }
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'POST') return next()

        const abs = join(root, 'netlify', 'functions', file)
        const href = pathToFileURL(abs).href
        let mod = fnCache.get(href)
        if (!mod) {
          mod = await import(href)
          fnCache.set(href, mod)
        }
        const { handler } = mod
        if (typeof handler !== 'function') return next()

        const body = await readBody(req)
        const event = {
          httpMethod: 'POST',
          path: pathOnly,
          body: body || '{}',
          headers: req.headers || {},
          isBase64Encoded: false,
        }
        let result
        try {
          result = await handler(event)
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          for (const [k, v] of Object.entries(baseHeaders)) {
            res.setHeader(k, v)
          }
          res.end(
            JSON.stringify({ error: e instanceof Error ? e.message : '함수 실행 오류' }),
            'utf8',
          )
          return
        }
        if (!result || typeof result !== 'object') {
          return next()
        }
        for (const [k, v] of Object.entries(baseHeaders)) {
          res.setHeader(k, v)
        }
        const outHeaders = result.headers || {}
        for (const [k, v] of Object.entries(outHeaders)) {
          if (v != null) res.setHeader(k, v)
        }
        res.statusCode = result.statusCode ?? 200
        res.end(typeof result.body === 'string' ? result.body : String(result.body ?? ''), 'utf8')
      })
    },
  }
}
