const LS_HASH = 'vaulter_vault_pin_hash'
const SESS = 'vaulter_vault_unlocked'

function getPepper() {
  return String(import.meta.env.VITE_VAULT_PIN_PEPPER || 'vaulter-vault-default-pepper-v1')
}

async function sha256Hex(text) {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashVaultPin(pin) {
  return sha256Hex(getPepper() + String(pin).trim())
}

export function isVaultPinConfigured() {
  try {
    return !!localStorage.getItem(LS_HASH)
  } catch {
    return false
  }
}

export function getStoredPinHash() {
  try {
    return localStorage.getItem(LS_HASH) || ''
  } catch {
    return ''
  }
}

export async function setVaultPin(pin) {
  const p = String(pin).trim()
  if (p.length < 4) throw new Error('PIN은 4자리 이상이어야 합니다.')
  const h = await hashVaultPin(p)
  localStorage.setItem(LS_HASH, h)
}

export function clearVaultPin() {
  try {
    localStorage.removeItem(LS_HASH)
  } catch {
    // ignore
  }
}

export function isVaultUnlockedThisSession() {
  try {
    return sessionStorage.getItem(SESS) === '1'
  } catch {
    return false
  }
}

export function setVaultUnlockedThisSession() {
  try {
    sessionStorage.setItem(SESS, '1')
  } catch {
    // ignore
  }
}

export async function verifyVaultPinOnServer(pin) {
  const storedHash = getStoredPinHash()
  if (!storedHash) return { ok: false, error: 'PIN이 설정되지 않았습니다.' }
  const res = await fetch('/api/vault-verify-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, storedHash }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: data?.error || '확인에 실패했습니다.' }
  }
  if (data.ok) setVaultUnlockedThisSession()
  return { ok: !!data.ok, error: data.ok ? undefined : 'PIN이 맞지 않습니다.' }
}
