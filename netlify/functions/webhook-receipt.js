import crypto from 'node:crypto'
import {
  CORS,
  initBlobsContext,
  getBlobStore,
  json,
  loadOpenAiKey,
  safeParseJSON,
  parseUserIdToken,
  assertAuthPair,
} from './webhookCommon.js'

function todayIsoDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function nowIsoDateTimeMinute() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}`
}

function buildWebhookParsePrompt() {
  const nowHint = nowIsoDateTimeMinute()
  return `너는 금융 데이터 추출 전문가다.
유저가 보낸 결제/입금 알림 텍스트의 문맥을 분석하여, 반드시 아래 JSON 스키마 구조로만 답변해라.
절대 다른 부연 설명을 덧붙이지 마라.

출력 규칙:
- 출력은 오직 JSON object 하나
- Markdown/code fence/주석/설명 금지
- 금액은 숫자형(콤마/통화기호 제거)
- type은 반드시 "INCOME" 또는 "EXPENSE"
- category가 애매하면 "미분류"
- 날짜를 추론할 수 없으면 현재 시각 힌트(${nowHint}) 기준의 YYYY-MM-DD HH:mm 사용

JSON 스키마:
{
  "date": "YYYY-MM-DD HH:mm",
  "amount": 0,
  "vendor": "결제처 또는 상호명",
  "type": "INCOME 또는 EXPENSE",
  "category": "애매하면 미분류",
  "memo": "특이사항, 할부 정보, 참고 메모"
}`
}

const EXPENSE_CATEGORY_ENUM = [
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

const INCOME_CATEGORY_ENUM = ['급여', '부수입', '금융 수입', '기타 수입']

function normalizeParsedCategory(type, rawCategory) {
  const category = String(rawCategory || '').trim()
  if (type === 'INCOME') {
    if (INCOME_CATEGORY_ENUM.includes(category)) return category
    return '기타 수입'
  }
  if (EXPENSE_CATEGORY_ENUM.includes(category)) return category
  return '기타 지출'
}

function buildSafeFallback(rawText) {
  return {
    date: nowIsoDateTimeMinute(),
    amount: 0,
    vendor: '파싱실패',
    type: 'EXPENSE',
    category: '미분류',
    memo: `JSON_PARSE_FAILED | ${String(rawText || '').slice(0, 500)}`,
  }
}

function parseModelJsonOrFallback(modelContent, rawText) {
  const text = String(modelContent || '').trim()
  try {
    if (!text) throw new Error('EMPTY_CONTENT')
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') throw new Error('NOT_OBJECT')
    return parsed
  } catch {
    return buildSafeFallback(rawText)
  }
}

function normalizeModelOutput(parsed, rawText) {
  const typeText = String(parsed?.type || '').trim().toUpperCase()
  const type = typeText === 'INCOME' ? 'INCOME' : 'EXPENSE'
  const amountNum = Math.abs(Number(parsed?.amount))
  const amount = Number.isFinite(amountNum) ? amountNum : 0
  const vendor =
    String(parsed?.vendor || parsed?.title || '').trim() ||
    '웹훅 알림'
  const memo = String(parsed?.memo || '').trim() || String(rawText || '').slice(0, 500)

  let date = String(parsed?.date || '').trim()
  if (!date) date = nowIsoDateTimeMinute()
  if (date.length === 10 && date.includes('-')) {
    const hm = nowIsoDateTimeMinute().slice(11, 16)
    date = `${date} ${hm}`
  }

  const categoryInput = String(parsed?.category || '').trim()
  const category =
    categoryInput === '미분류'
      ? (type === 'INCOME' ? '기타 수입' : '기타 지출')
      : normalizeParsedCategory(type, categoryInput)

  return {
    type,
    amount,
    date,
    vendor,
    category,
    memo,
  }
}

function safeParseRequestBody(event) {
  if (!event?.body) return { text: '' }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : String(event.body)
  const o = safeParseJSON(raw)
  if (o && typeof o === 'object' && typeof o.text === 'string') {
    return { text: o.text }
  }
  if (typeof raw === 'string' && raw.trim()) {
    return { text: raw.trim() }
  }
  return { text: '' }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
  }
  if (!initBlobsContext(event)) {
    return json(503, { ok: false, error: 'BLOBS_CONTEXT_UNAVAILABLE' })
  }
  const parsedQs = parseUserIdToken(event)
  if (!parsedQs.ok) {
    return json(400, { ok: false, error: parsedQs.error })
  }
  const { userId, token } = parsedQs
  const store = getBlobStore()
  const auth = await assertAuthPair(store, userId, token)
  if (!auth.ok) {
    return json(auth.status, { ok: false, error: auth.error })
  }
  const { text } = safeParseRequestBody(event)
  if (!String(text).trim()) {
    return json(400, { ok: false, error: 'EMPTY_TEXT' })
  }
  const apiKey = loadOpenAiKey()
  if (!apiKey) {
    return json(500, { ok: false, error: 'OPENAI_NOT_CONFIGURED' })
  }
  const body = {
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildWebhookParsePrompt() },
      { role: 'user', content: String(text).slice(0, 8000) },
    ],
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    return json(502, { ok: false, error: 'OPENAI_ERROR', detail: t.slice(0, 200) })
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  const parsed = parseModelJsonOrFallback(content, text)
  const normalized = normalizeModelOutput(parsed, text)
  const idPart = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  const key = `q/${userId}/${idPart}.json`
  const record = {
    v: 1,
    createdAt: new Date().toISOString(),
    key,
    parsed: {
      type: normalized.type,
      category: normalized.category,
      amount: normalized.amount,
      date: String(normalized.date || todayIsoDate()).trim(),
      title: normalized.vendor.length > 200 ? normalized.vendor.slice(0, 200) : normalized.vendor,
      memo: normalized.memo,
    },
    rawText: String(text).slice(0, 12000),
  }
  await store.set(key, JSON.stringify(record), { metadata: { userId, kind: 'receipt' } })
  return json(200, { ok: true, id: idPart, key })
}
