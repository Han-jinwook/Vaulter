import { getStore } from '@netlify/blobs'
import { BILLING_STORE_NAME, json, safeParseJSON, CORS } from './webhookCommon.js'

// 허브 SDK 라이브러리를 동적 로딩하여 chargeDynamic를 실행하기 위한 모듈
// Netlify Functions (Node.js 환경)용 chargeDynamic 바인딩
import { configureMerlinHub, chargeDynamic } from '../src/services/merlin-hub-sdk/index.js'

// App ID 초기화
configureMerlinHub({ appId: 'Vaulter' })

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }

  const path = event.path || ''
  const action = path.split('/').pop()

  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { ok: false, error: 'INVALID_JSON' })
  }

  const { userId } = body
  if (!userId) {
    return json(400, { ok: false, error: 'MISSING_USER_ID' })
  }

  const store = getStore(BILLING_STORE_NAME)
  const userKey = `session_${userId}.json`

  // 1. 누적 API
  if (action === 'accumulate') {
    const { gpt4oMiniTokens = 0, gemini25FlashTokens = 0, googleSearchCount = 0, detailLog } = body

    let record = {
      userId,
      gpt4oMiniTokens: 0,
      gemini25FlashTokens: 0,
      googleSearchCount: 0,
      lastActiveAt: new Date().toISOString(),
      cctv_logs: []
    }

    const raw = await store.get(userKey, { type: 'text' })
    if (raw) {
      const parsed = safeParseJSON(raw)
      if (parsed) {
        record = { ...record, ...parsed }
      }
    }

    record.gpt4oMiniTokens += gpt4oMiniTokens
    record.gemini25FlashTokens += gemini25FlashTokens
    record.googleSearchCount += googleSearchCount
    record.lastActiveAt = new Date().toISOString()

    if (detailLog) {
      record.cctv_logs.push({
        timestamp: new Date().toISOString(),
        ...detailLog
      })
    }

    await store.set(userKey, JSON.stringify(record))
    return json(200, { ok: true, message: 'METRICS_ACCUMULATED', currentBuffer: record })
  }

  // 2. 정산 플러시 API
  if (action === 'flush') {
    const raw = await store.get(userKey, { type: 'text' })
    if (!raw) {
      return json(200, { ok: true, message: 'NO_BUFFERED_DATA_TO_FLUSH' })
    }

    const record = safeParseJSON(raw)
    if (!record || (record.gpt4oMiniTokens === 0 && record.gemini25FlashTokens === 0 && record.googleSearchCount === 0)) {
      await store.delete(userKey)
      return json(200, { ok: true, message: 'EMPTY_BUFFER_CLEARED' })
    }

    // 1회 통합 dynamic 과금 요청 실행
    try {
      const resourceId = `session_flush_${Date.now()}`
      const reqId = `charge_flush_${userId}_${Date.now()}`

      // CCTV 상세 로그에 누적 기록 합치기
      const cctvLogs = record.cctv_logs || []
      cctvLogs.push({
        timestamp: new Date().toISOString(),
        action: '세션 종료 통합 플러시 정산',
        tokens: record.gpt4oMiniTokens
      })

      const billingRes = await chargeDynamic({
        userId: userId,
        videoId: resourceId,
        usageMetrics: {
          gpt4oMiniTokens: record.gpt4oMiniTokens,
          gemini25FlashTokens: record.gemini25FlashTokens,
          googleSearchCount: record.googleSearchCount
        },
        requestId: reqId,
        displayText: "금고지기 AI 세션 이용 통합 정산",
        usageMetadata: {
          cctv_logs: cctvLogs
        }
      })

      if (!billingRes.success) {
        return json(500, { ok: false, error: 'HUB_BILLING_FAILED', detail: billingRes.error })
      }

      // 정산 성공 시에만 버퍼 삭제
      await store.delete(userKey)
      return json(200, {
        ok: true,
        message: 'SESSION_FLUSHED',
        price: billingRes.price,
        balance: billingRes.balance
      })
    } catch (err) {
      console.error('[SessionBilling] Flush error:', err)
      return json(500, { ok: false, error: 'FLUSH_EXCEPTION', detail: String(err) })
    }
  }

  return json(404, { ok: false, error: 'UNKNOWN_ACTION' })
}
