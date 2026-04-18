export type GmailAuthToken = {
  accessToken: string
  refreshToken?: string | null
  expiresAt: number
  scope: string
  tokenType: string
}

export type BackgroundParsedItem = {
  source: 'gmail'
  sourceMessageId: string
  merchant: string
  date: string | null
  amount: number
  category: string
  reasoning?: string
  confidence?: number
}

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_SYNC_DB = 'vaulter-gmail-sync'
const GMAIL_SYNC_STORE = 'kv'
const KEY_AUTH = 'gmail_auth'
const KEY_PENDING_QUEUE = 'gmail_pending_queue'
const KEY_DIGEST_HOUR = 'gmail_digest_hour'
const KEY_PROCESSED_IDS = 'gmail_processed_ids'

type DbValue = GmailAuthToken | BackgroundParsedItem[] | number | null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(GMAIL_SYNC_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(GMAIL_SYNC_STORE)) {
        db.createObjectStore(GMAIL_SYNC_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

async function dbGet<T extends DbValue>(key: string): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GMAIL_SYNC_STORE, 'readonly')
    const store = tx.objectStore(GMAIL_SYNC_STORE)
    const req = store.get(key)
    req.onsuccess = () => resolve((req.result ?? null) as T)
    req.onerror = () => reject(req.error || new Error(`IndexedDB get failed: ${key}`))
  })
}

async function dbSet(key: string, value: DbValue): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GMAIL_SYNC_STORE, 'readwrite')
    tx.objectStore(GMAIL_SYNC_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(`IndexedDB set failed: ${key}`))
  })
}

async function dbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GMAIL_SYNC_STORE, 'readwrite')
    tx.objectStore(GMAIL_SYNC_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(`IndexedDB delete failed: ${key}`))
  })
}

async function dbKeys(): Promise<string[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GMAIL_SYNC_STORE, 'readonly')
    const store = tx.objectStore(GMAIL_SYNC_STORE)
    if ('getAllKeys' in store) {
      const req = store.getAllKeys()
      req.onsuccess = () => resolve((req.result || []).map((k) => String(k)))
      req.onerror = () => reject(req.error || new Error('IndexedDB getAllKeys failed'))
      return
    }
    const keys: string[] = []
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve(keys)
        return
      }
      keys.push(String(cursor.key))
      cursor.continue()
    }
    req.onerror = () => reject(req.error || new Error('IndexedDB cursor failed'))
  })
}

function ensureGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const already = document.querySelector('script[data-gsi-client="true"]')
    if (already) {
      already.addEventListener('load', () => resolve(), { once: true })
      already.addEventListener('error', () => reject(new Error('Google Identity SDK load failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.gsiClient = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Identity SDK load failed'))
    document.head.appendChild(script)
  })
}

export function buildPaymentMailQuery() {
  return [
    'after:2026/01/01',
    'before:2027/01/01',
    '(',
    'from:coupang.com',
    'OR from:naver.com',
    'OR from:woowahan.com',
    'OR from:netflix.com',
    'OR subject:결제',
    'OR subject:승인',
    'OR subject:영수증',
    'OR subject:구독',
    ')',
  ].join(' ')
}

export async function connectGmailReadonly(): Promise<GmailAuthToken> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.')
  }
  await ensureGoogleIdentityScript()
  const existing = await getStoredGmailAuth()
  return new Promise((resolve, reject) => {
    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const resolveOnce = (token: GmailAuthToken) => {
      if (settled) return
      settled = true
      resolve(token)
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GMAIL_SCOPE,
      prompt: existing ? '' : 'consent',
      callback: async (response) => {
        if (settled) return
        if ((response as any).error || !response.access_token) {
          rejectOnce(new Error(`Gmail OAuth 실패: ${(response as any).error || 'unknown'}`))
          return
        }
        try {
          const token: GmailAuthToken = {
            accessToken: response.access_token,
            refreshToken: (response as any).refresh_token || existing?.refreshToken || null,
            expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            scope: response.scope || GMAIL_SCOPE,
            tokenType: response.token_type || 'Bearer',
          }
          await dbSet(KEY_AUTH, token)
          resolveOnce(token)
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error('Gmail 토큰 저장 중 오류가 발생했습니다.'))
        }
      },
      error_callback: (error) => {
        const type = error?.type || 'unknown'
        if (type === 'popup_closed') {
          rejectOnce(new Error('Google 로그인 팝업이 닫혀 Gmail 연동이 취소되었습니다.'))
          return
        }
        if (type === 'popup_failed_to_open') {
          rejectOnce(new Error('Google 로그인 팝업을 열지 못했습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'))
          return
        }
        rejectOnce(new Error(`Google OAuth 요청 실패: ${type}`))
      },
    })
    tokenClient.requestAccessToken()
  })
}

export async function getStoredGmailAuth(): Promise<GmailAuthToken | null> {
  return dbGet<GmailAuthToken | null>(KEY_AUTH)
}

export async function ensureGmailAccessToken(): Promise<string> {
  const token = await getStoredGmailAuth()
  if (!token) {
    throw new Error('Gmail이 연동되지 않았습니다. 먼저 Gmail 연동을 실행해 주세요.')
  }
  // GIS token client in SPA usually doesn't provide refresh token.
  // Re-consent is currently required after expiry in local-only mode.
  if (token.expiresAt <= Date.now() + 60_000) {
    throw new Error('Gmail 토큰이 만료되었습니다. Gmail 연동을 다시 실행해 주세요.')
  }
  return token.accessToken
}

export async function validateGmailReadonlyAccess(accessTokenOverride?: string): Promise<void> {
  const accessToken = accessTokenOverride || (await ensureGmailAccessToken())
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (response.ok) return

  const raw = await response.text()
  let friendly = `Gmail API 접근 실패 (${response.status})`
  try {
    const parsed = JSON.parse(raw)
    const reason = parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || ''
    if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
      friendly =
        'Gmail API가 Google Cloud 프로젝트에서 비활성화 상태입니다. API 사용 설정 후 2~10분 뒤 다시 시도해 주세요.'
    } else if (reason === 'authError' || response.status === 401) {
      friendly = 'Gmail 인증 토큰이 유효하지 않습니다. Gmail 연동을 다시 실행해 주세요.'
    } else if (reason) {
      friendly = `Gmail API 접근 실패: ${reason}`
    }
  } catch {
    // keep fallback message
  }

  throw new Error(friendly)
}

export async function drainBackgroundPendingQueue(): Promise<BackgroundParsedItem[]> {
  const queue = (await dbGet<BackgroundParsedItem[] | null>(KEY_PENDING_QUEUE)) || []
  await dbSet(KEY_PENDING_QUEUE, [])
  return queue
}

export async function getDigestHourPreference(): Promise<number> {
  const value = await dbGet<number | null>(KEY_DIGEST_HOUR)
  return Number.isFinite(value as number) ? Number(value) : 20
}

export async function setDigestHourPreference(hour: number): Promise<void> {
  const safeHour = Math.max(0, Math.min(23, Number(hour) || 20))
  await dbSet(KEY_DIGEST_HOUR, safeHour)
}

export async function clearGmailSyncTestData(keepAuth = true): Promise<void> {
  const keys = await dbKeys()
  const targets = keys.filter((key) => {
    if (key === KEY_PENDING_QUEUE) return true
    if (key === KEY_PROCESSED_IDS) return true
    if (key.startsWith('gmail_digest_')) return true
    if (!keepAuth && key === KEY_AUTH) return true
    return false
  })
  await Promise.all(targets.map((key) => dbDelete(key)))
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            prompt?: string
            callback: (response: {
              access_token?: string
              expires_in?: number
              scope?: string
              token_type?: string
              error?: string
            }) => void
            error_callback?: (error: {
              type?: string
            }) => void
          }) => { requestAccessToken: () => void }
        }
      }
    }
  }
}
