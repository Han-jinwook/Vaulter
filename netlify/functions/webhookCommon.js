import { connectLambda, getStore } from '@netlify/blobs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const STORE_NAME = 'webhook-ledger-inbox'
export const BILLING_STORE_NAME = 'vaulter-billing-buffer'
export const AUTH_PREFIX = 'auth/'
export const QUEUE_PREFIX = 'q/'

export function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

export function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export function initBlobsContext(event) {
  if (event && event.blobs) {
    connectLambda(event)
    return true
  }
  return false
}

export function getBlobStore() {
  return getStore(STORE_NAME)
}

export function loadOpenAiKey() {
  const envKey = process.env.OPENAI_API_KEY
  if (envKey) return envKey
  try {
    const envPath = path.resolve(process.cwd(), '.env')
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m)
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null
  } catch {
    return null
  }
}

export const ADD_LEDGER_EXPENSE_CATEGORIES = [
  '식비',
  '교통/차량',
  '쇼핑/뷰티',
  '주거/통신',
  '문화/여가',
  '건강/병원',
  '이자/금융수수료',
  '카드대금 결제',
  '대출 상환',
  '기타 지출',
]
export const ADD_LEDGER_INCOME_CATEGORIES = ['급여', '부수입', '금융 수입', '기타 수입']

export function addLedgerCategoryEnumBlock() {
  return `【add_ledger_entry — 카테고리 고정 Enum(반드시 이 명칭만)】
- type=EXPENSE(지출)일 때 **category** 는 다음 중 **정확히 하나**만: ${ADD_LEDGER_EXPENSE_CATEGORIES.join(', ')}
- type=INCOME(수입)일 때 **category** 는 다음 중 **정확히 하나**만: ${ADD_LEDGER_INCOME_CATEGORIES.join(', ')}
[카테고리 매핑 룰] 임의의 카테고리 문구를 새로 만들지 말고, 애매하면 type에 맞게 **'기타 지출'** 또는 **'기타 수입'**을 써라.
- **이자/금융수수료**·**카드대금 결제**·**대출 상환** 의미는 지기 chat-assistant 프롬프트와 동일하게 취급한다.`
}

const USER_ID_RE = /^[a-f0-9]{32,128}$/
const TOKEN_RE = /^[a-f0-9]{32,256}$/

export function parseUserIdToken(event) {
  const qs = event?.queryStringParameters || {}
  const userId = String(qs.userId || qs.userid || '').trim().toLowerCase()
  const token = String(qs.token || '').trim().toLowerCase()
  if (!userId || !token) {
    return { ok: false, error: 'MISSING_QUERY', userId: '', token: '' }
  }
  if (!USER_ID_RE.test(userId) || !TOKEN_RE.test(token)) {
    return { ok: false, error: 'INVALID_ID_FORMAT', userId: '', token: '' }
  }
  return { ok: true, userId, token, error: '' }
}

function timingEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8')
  const y = Buffer.from(String(b), 'utf8')
  if (x.length !== y.length) return false
  return crypto.timingSafeEqual(x, y)
}

export async function readStoredToken(store, userId) {
  const key = `${AUTH_PREFIX}${userId}.json`
  const raw = await store.get(key, { type: 'text' })
  if (raw == null) return null
  const o = safeParseJSON(raw)
  if (o && typeof o.t === 'string') return o.t
  return null
}

export async function assertAuthPair(store, userId, token) {
  const stored = await readStoredToken(store, userId)
  if (stored == null) {
    return { ok: false, status: 401, error: 'NOT_REGISTERED' }
  }
  if (!timingEqual(stored, token)) {
    return { ok: false, status: 403, error: 'INVALID_TOKEN' }
  }
  return { ok: true }
}
