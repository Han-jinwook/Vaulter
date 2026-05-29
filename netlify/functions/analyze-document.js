import fs from 'node:fs'
import path from 'node:path'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  }
}

function safeParseJSON(text) {
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

function readLocalEnvValue(key) {
  try {
    const envPath = path.join(process.cwd(), '.env')
    if (!fs.existsSync(envPath)) return ''
    const raw = fs.readFileSync(envPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx < 0) continue
      const name = trimmed.slice(0, idx).trim()
      if (name !== key) continue
      return trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // ignore local env parse failures
  }
  return ''
}

function normalizeDate(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const match = text.match(/(\d{4})[-./년]\s*(\d{1,2})[-./월]?\s*(\d{1,2})/)
  if (!match) return null
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`
}

function normalizeAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value)
  const digits = String(value || '')
    .replace(/[^\d.-]/g, '')
    .trim()
  const amount = Number(digits)
  return Number.isFinite(amount) ? Math.abs(amount) : 0
}

function normalizeItem(item, sourceName, fallbackIndex) {
  const merchant = String(item?.merchant || '').trim() || sourceName || `문서 항목 ${fallbackIndex + 1}`
  const category = String(item?.category || '기타').trim() || '기타'
  const account = String(item?.account || '').trim()
  const reasoning = String(item?.reasoning || '').trim()
  const confidence = Number(item?.confidence || 0.72)

  return {
    date: normalizeDate(item?.date),
    merchant,
    category,
    amount: normalizeAmount(item?.amount),
    account,
    reasoning,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.72,
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY || readLocalEnvValue('OPENAI_API_KEY')
  if (!apiKey) {
    return json(503, { ok: false, error: 'OPENAI_API_KEY is not configured' })
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { ok: false, error: 'invalid_json' })
  }

  const documentType = String(payload?.documentType || '').trim().toLowerCase()
  const sourceName = String(payload?.sourceName || '문서').trim()
  const chunkText = String(payload?.chunkText || '').trim()
  const chunkIndex = Number(payload?.chunkIndex || 1)
  const totalChunks = Number(payload?.totalChunks || 1)
  const itemStart = Number(payload?.itemStart || 1)
  const itemEnd = Number(payload?.itemEnd || itemStart)
  const columnHints = Array.isArray(payload?.columnHints)
    ? payload.columnHints.map((value) => String(value || '').trim()).filter(Boolean)
    : []

  if (!documentType || !chunkText) {
    return json(400, { ok: false, error: 'documentType and chunkText are required' })
  }

  const systemPrompt = [
    'You convert raw financial document text into Vaulter ledger entries.',
    'Return JSON only in the shape {"items":[...]} with no markdown.',
    'Each item must map to the schema { date, merchant, category, amount, account, reasoning, confidence }.',
    'Rules:',
    '- date must be YYYY-MM-DD when inferable, otherwise null.',
    '- amount must be a positive number without currency symbols.',
    '- merchant/category/account must be short strings in Korean when possible.',
    '- reasoning should be one short sentence describing how you matched the row.',
    '- confidence must be between 0 and 1.',
    '- Ignore header rows, totals, balances, and non-transaction text.',
    '- When account is unknown, use an empty string.',
  ].join('\n')

  const userPrompt = [
    `documentType: ${documentType}`,
    `sourceName: ${sourceName}`,
    `chunkIndex: ${chunkIndex}/${totalChunks}`,
    `range: ${itemStart}-${itemEnd}`,
    columnHints.length ? `columnHints: ${columnHints.join(' | ')}` : 'columnHints: none',
    '',
    'raw chunk text:',
    chunkText,
  ].join('\n')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  const text = await response.text()
  const openAiPayload = safeParseJSON(text)

  if (!response.ok) {
    return json(response.status, {
      ok: false,
      error: openAiPayload?.error?.message || 'openai_request_failed',
      detail: text,
    })
  }

  const content = openAiPayload?.choices?.[0]?.message?.content
  const parsed = safeParseJSON(content)
  const items = Array.isArray(parsed?.items) ? parsed.items : []

  return json(200, {
    ok: true,
    items: items.map((item, index) => normalizeItem(item, sourceName, index)).filter((item) => item.amount > 0),
    usage: openAiPayload?.usage,
  })
}
