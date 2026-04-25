import crypto from 'node:crypto'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

function getPepper() {
  return String(process.env.VAULT_PIN_PEPPER || 'vaulter-vault-default-pepper-v1')
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(getPepper() + String(pin).trim(), 'utf8').digest('hex')
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }
  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' })
  }
  const { pin, storedHash } = body
  if (typeof pin !== 'string' || !pin.trim()) {
    return json(400, { error: 'pin이 필요합니다.' })
  }
  if (typeof storedHash !== 'string' || !storedHash) {
    return json(400, { error: 'storedHash가 필요합니다. 설정에서 PIN을 먼저 등록하세요.' })
  }
  const h = hashPin(pin)
  return json(200, { ok: h === storedHash })
}
