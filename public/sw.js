const DB_NAME = 'vaulter-gmail-sync'
const STORE_NAME = 'kv'
const KEY_AUTH = 'gmail_auth'
const KEY_PROCESSED_IDS = 'gmail_processed_ids'
const KEY_PENDING_QUEUE = 'gmail_pending_queue'
const KEY_DIGEST_HOUR = 'gmail_digest_hour'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

async function dbGet(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error || new Error(`IndexedDB get failed: ${key}`))
  })
}

async function dbSet(key, value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(`IndexedDB set failed: ${key}`))
  })
}

function buildPaymentMailQuery() {
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

function b64urlToString(value) {
  if (!value) return ''
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    return decodeURIComponent(
      atob(base64 + pad)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join('')
    )
  } catch {
    return ''
  }
}

function pickHeader(headers, name) {
  return String((headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '').trim()
}

function collectPayloadText(payload, collected = []) {
  if (!payload) return collected
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    collected.push(b64urlToString(payload.body.data))
  }
  for (const part of payload.parts || []) {
    collectPayloadText(part, collected)
  }
  return collected
}

async function gmailFetchJson(path, accessToken) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Gmail API ${res.status}: ${detail}`)
  }
  return res.json()
}

function dateKeyForToday() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function pushPendingToQueue(items) {
  if (!items.length) return
  const existing = (await dbGet(KEY_PENDING_QUEUE)) || []
  const merged = [...items, ...existing]
  await dbSet(KEY_PENDING_QUEUE, merged.slice(0, 500))
}

async function pushSinglePendingToQueue(item) {
  await pushPendingToQueue([item])
}

async function incrementDigestCounter(count) {
  const day = dateKeyForToday()
  const key = `gmail_digest_count_${day}`
  const prev = Number((await dbGet(key)) || 0)
  await dbSet(key, prev + count)
}

async function maybeShowDigestNotification() {
  if (Notification.permission !== 'granted') return
  const digestHour = Number((await dbGet(KEY_DIGEST_HOUR)) ?? 20)
  const now = new Date()
  if (now.getHours() < digestHour) return

  const day = dateKeyForToday()
  const notifiedKey = `gmail_digest_notified_${day}`
  if (await dbGet(notifiedKey)) return

  const count = Number((await dbGet(`gmail_digest_count_${day}`)) || 0)
  if (count < 1) return

  await self.registration.showNotification('금고지기 비서 보고', {
    body: `오늘 결제 메일 ${count}건이 금고에 정리되었습니다. 편하실 때 확인해 주세요.`,
    icon: '/favicon.ico',
    tag: `vaulter-digest-${day}`,
  })
  await dbSet(notifiedKey, true)
}

async function broadcast(type, payload) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  clients.forEach((client) => client.postMessage({ type, payload }))
}

async function runGmailSync() {
  const auth = await dbGet(KEY_AUTH)
  if (!auth?.accessToken) {
    // 토큰이 없을 때는 상태를 남기지 않는다(새로고침 직후 '메일 읽는 중' 등 오표시 방지).
    await broadcast('GMAIL_SYNC_STATUS', { text: '' })
    return
  }
  if (Number(auth.expiresAt || 0) <= Date.now() + 60_000) {
    await broadcast('GMAIL_SYNC_AUTH_EXPIRED', null)
    return
  }

  await broadcast('GMAIL_SYNC_STATUS', { text: '결제 메일 읽는 중...' })
  const query = encodeURIComponent(buildPaymentMailQuery())
  const list = await gmailFetchJson(`messages?q=${query}&maxResults=5`, auth.accessToken)
  const messages = list.messages || []
  if (!messages.length) {
    await broadcast('GMAIL_SYNC_STATUS', { text: '새 결제 메일 없음' })
    await maybeShowDigestNotification()
    return
  }

  const processed = new Set((await dbGet(KEY_PROCESSED_IDS)) || [])
  const candidates = messages.filter((msg) => msg?.id && !processed.has(msg.id))
  console.info('[GmailDebug][SW] messages:', messages.length, 'candidates:', candidates.length)
  if (!candidates.length) {
    await broadcast('GMAIL_SYNC_STATUS', { text: '이미 처리된 메일만 존재' })
    await maybeShowDigestNotification()
    return
  }
  const successfullyProcessedIds = []
  let completed = 0

  const parseOneMessage = async (msg) => {
    await broadcast('GMAIL_SYNC_STATUS', { text: `메일 분석 중... (${completed + 1}/${candidates.length})` })
    const detail = await gmailFetchJson(`messages/${msg.id}?format=full`, auth.accessToken)
    const headers = detail.payload?.headers || []
    const subject = pickHeader(headers, 'Subject')
    const from = pickHeader(headers, 'From')
    const date = pickHeader(headers, 'Date')
    const snippet = String(detail.snippet || '').trim()
    const body = collectPayloadText(detail.payload).join('\n').slice(0, 7000)

    const parseRes = await fetch('/api/analyze-email-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'gmail',
        messageId: msg.id,
        subject,
        from,
        date,
        snippet,
        body,
      }),
    })
    if (!parseRes.ok) {
      const detail = await parseRes.text()
      console.warn('[GmailDebug][SW] parse failed:', msg.id, parseRes.status, detail)
      await broadcast('GMAIL_SYNC_ERROR', `[${msg.id}] parse failed ${parseRes.status}`)
      return
    }

    const parsed = await parseRes.json()
    const data = parsed?.data || {}
    const normalizedAmount = Math.abs(Number(data.amount || 0))
    const normalizedConfidence = Number(data.confidence || 0.8)
    const isTinyAmount = Number.isFinite(normalizedAmount) && normalizedAmount > 0 && normalizedAmount < 100

    const item = {
      source: 'gmail',
      sourceMessageId: msg.id,
      merchant: String(data.merchant || from || '가맹점 미확인').trim(),
      date: data.date || date || null,
      amount: normalizedAmount,
      category: String(data.category || '기타').trim(),
      reasoning: isTinyAmount
        ? `${String(data.reasoning || '').trim() || '소액 결제로 추정됩니다.'} (원문 금액 재확인 권장)`
        : String(data.reasoning || '').trim(),
      // 소액 결제는 드롭하지 않고 검토 대상으로 보내기 위해 confidence를 낮춘다.
      confidence: isTinyAmount ? Math.min(normalizedConfidence, 0.45) : normalizedConfidence,
    }

    await pushSinglePendingToQueue(item)
    await incrementDigestCounter(1)
    console.info('[GmailDebug][SW] parsed message:', msg.id, '->', item.merchant, item.amount)
    await broadcast('GMAIL_SYNC_PARSED', {
      items: [item],
      meta: [
        {
          sourceMessageId: msg.id,
          queued: true,
          parsedAt: Date.now(),
        },
      ],
    })
    completed += 1
    await broadcast('GMAIL_SYNC_STATUS', { text: `원장 반영 완료 (${completed}/${candidates.length})` })
    successfullyProcessedIds.push(msg.id)
  }

  const concurrency = 3
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const idx = cursor
      cursor += 1
      try {
        await parseOneMessage(candidates[idx])
      } catch (error) {
        await broadcast('GMAIL_SYNC_ERROR', `[${candidates[idx]?.id}] ${String(error?.message || error)}`)
      }
    }
  })
  await Promise.all(workers)

  if (successfullyProcessedIds.length) {
    successfullyProcessedIds.forEach((id) => processed.add(id))
    await dbSet(KEY_PROCESSED_IDS, Array.from(processed).slice(-2000))
  }

  await maybeShowDigestNotification()
  if (!successfullyProcessedIds.length) {
    await broadcast('GMAIL_SYNC_STATUS', { text: '분석 완료(신규 반영 0건)' })
  } else {
    await broadcast('GMAIL_SYNC_STATUS', { text: 'Gmail 동기화 완료' })
  }
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'GMAIL_SYNC_TICK') {
    event.waitUntil(
      runGmailSync().catch((error) => broadcast('GMAIL_SYNC_ERROR', String(error?.message || error)))
    )
  }
  if (event.data?.type === 'SET_GMAIL_DIGEST_HOUR') {
    event.waitUntil(dbSet(KEY_DIGEST_HOUR, Number(event.data?.payload ?? 20)))
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.length) return clients[0].focus()
      return self.clients.openWindow('/')
    })
  )
})
