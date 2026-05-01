import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import IsolatedChatComposer from './IsolatedChatComposer'
import { MessageWithActionLinks } from './MessageWithActionLinks'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'
import { isConsumptiveLedgerExpense } from '../../lib/ledgerCategoryPolicy'
import { resolveApiUrl } from '../../lib/resolveApiUrl'
import { CHAT_PANEL_ASIDE_LAYOUT } from './chatPanelAsideLayout'
import { normalizeLedgerAccountLabel } from '../../lib/ledgerAccountNormalize'

// 날짜 문자열 → YYYY-MM-DD 정규화 (다양한 포맷 대응)
function normalizeDate(d) {
  if (!d) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10)          // 2026-04-02
  if (/^\d{4}\.\d{2}\.\d{2}/.test(d)) return d.slice(0, 10).replace(/\./g, '-') // 2026.04.02
  if (/^\d{8}$/.test(d)) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}` // 20260402
  const parsed = new Date(d)
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10)
  return d
}

function dedupeLedgerDeleteItems(items) {
  const seen = new Set()
  const out = []
  for (const it of items) {
    const id = String(it?.txId ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(it)
  }
  return out
}

function fmtLedgerLineAmount(n) {
  const num = Number(n) || 0
  const abs = Math.abs(num).toLocaleString('ko-KR')
  return num > 0 ? `+₩${abs}` : `-₩${abs}`
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

function editDistanceWithin(a, b, limit = 1) {
  const s = String(a || '')
  const t = String(b || '')
  const n = s.length
  const m = t.length
  if (Math.abs(n - m) > limit) return false
  if (s === t) return true
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i += 1) dp[i][0] = i
  for (let j = 0; j <= m; j += 1) dp[0][j] = j
  for (let i = 1; i <= n; i += 1) {
    let rowMin = limit + 1
    for (let j = 1; j <= m; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
      if (dp[i][j] < rowMin) rowMin = dp[i][j]
    }
    if (rowMin > limit) return false
  }
  return dp[n][m] <= limit
}

function fuzzyTextMatch(fieldValue, queryValue) {
  const raw = String(fieldValue || '').toLowerCase().trim()
  const qRaw = String(queryValue || '').toLowerCase().trim()
  if (!qRaw) return true
  if (!raw) return false
  if (raw.includes(qRaw)) return true

  const norm = normalizeSearchText(fieldValue)
  const qNorm = normalizeSearchText(queryValue)
  if (!qNorm) return true
  if (!norm) return false
  if (norm.includes(qNorm) || qNorm.includes(norm)) return true

  // 짧은 오타(예: 가계부샘플 -> 가계브샘플) 흡수: 길이 충분할 때만 1글자 허용
  if (qNorm.length >= 4 && norm.length >= 4) {
    const short = Math.min(qNorm.length, norm.length)
    if (short <= 24 && editDistanceWithin(norm, qNorm, 1)) return true
  }
  return false
}

function fuzzySourceMatch(fieldValue, queryValue) {
  const canonicalMap = {
    manual: ['manual', '입력', '직접입력', '수기'],
    upload: ['upload', '문서', '가져온', '가져오기', '파일', '시트', '샘플'],
    gmail: ['gmail', '지메일', '메일'],
    webhook: ['webhook', '연동', '자동', '단축어', '훅'],
  }
  const fieldNorm = normalizeSearchText(fieldValue)
  const queryNorm = normalizeSearchText(queryValue)
  for (const aliases of Object.values(canonicalMap)) {
    const aliasNorm = aliases.map((v) => normalizeSearchText(v))
    const fieldHit = aliasNorm.some((a) => fieldNorm.includes(a) || a.includes(fieldNorm))
    const queryHit = aliasNorm.some((a) => queryNorm.includes(a) || a.includes(queryNorm))
    if (fieldHit && queryHit) return true
  }

  if (fuzzyTextMatch(fieldValue, queryValue)) return true
  const rawQuery = String(queryValue || '')
    .normalize('NFKC')
    .toLowerCase()
  const ignore = new Set(['삭제', '삭제해', '삭제하자', '거래', '내역', '입력', '입력한', '가져온', '건'])
  const tokens = rawQuery
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !ignore.has(t))
  return tokens.some((token) => fuzzyTextMatch(fieldValue, token))
}

/** 앱·전체 원장 통칭 — 소스 라벨 아님. 모델이 location에 넣으면 0건이 되므로 필터에서 제외 */
function sanitizeQueryLedgerLocation(raw) {
  const s = String(raw || '').trim()
  if (!s) return { effectiveLocation: null, strippedMeta: false }
  const n = normalizeSearchText(s)
  const metaNorm = new Set(
    [
      '가계부',
      '금고',
      '원장',
      '데이터 원장',
      '데이터원장',
      '전체',
      '앱',
      'vault',
      'keeper',
      'vaulter',
    ].map((x) => normalizeSearchText(x)),
  )
  if (metaNorm.has(n)) {
    return { effectiveLocation: null, strippedMeta: true, locationRaw: s }
  }
  return { effectiveLocation: s, strippedMeta: false }
}

function normalizeCategorySearchText(value) {
  return normalizeSearchText(String(value || '').replace(/비\b/g, ''))
}

function fuzzyCategoryMatch(fieldValue, queryValue) {
  if (fuzzyTextMatch(fieldValue, queryValue)) return true
  const fieldNorm = normalizeCategorySearchText(fieldValue)
  const queryNorm = normalizeCategorySearchText(queryValue)
  if (!queryNorm) return true
  if (!fieldNorm) return false
  return fieldNorm.includes(queryNorm) || queryNorm.includes(fieldNorm)
}

function merchantKeywordMatch(tx, keyword) {
  return (
    fuzzyTextMatch(tx?.name, keyword) ||
    fuzzyTextMatch(tx?.merchant, keyword) ||
    fuzzyTextMatch(tx?.userMemo, keyword)
  )
}

function formatQueryFilterSummary(args) {
  const parts = [
    args.startDate && args.endDate ? `기간 ${args.startDate}~${args.endDate}` : null,
    args.location ? String(args.location) : null,
    args.category ? `카테고리 ${args.category}` : null,
    args.merchant ? `상호 ${args.merchant}` : null,
    args.account ? `계정 ${args.account}` : null,
    args.type ? `유형 ${args.type}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '필터 없음'
}

function buildQueryRetryPlan(rawArgs) {
  const base = { ...(rawArgs || {}) }
  const plan = [{ label: '기본 조건', args: base }]

  const categoryKeyword = String(base.category || '').trim()
  const hasMerchant = String(base.merchant || '').trim().length > 0
  if (categoryKeyword && !hasMerchant) {
    const retryArgs = {
      ...base,
      merchant: categoryKeyword,
    }
    delete retryArgs.category
    plan.push({
      label: '카테고리 필터 해제 + 상호명 전환',
      args: retryArgs,
      loadingLabel: `카테고리 필터를 풀고 '${categoryKeyword}' 상호명으로 다시 찾는 중...`,
    })
  }

  // 기간·소스를 자동으로 풀면 (예: 4월+계정 질문) 전체 기간으로 넓어져 집계가 틀어지므로 재시도에서 제외한다.

  const deduped = []
  const seen = new Set()
  for (const item of plan) {
    const key = JSON.stringify(item.args)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
  }
  return deduped
}

/** 계정 질문 전 팩트 한 줄 — `need_account_clarify` 턴에 모델이 그대로 인용 */
function formatNeedAccountFactLine(summary) {
  if (!summary) return ''
  const ymd = summary.date != null && String(summary.date) !== '' ? normalizeDate(String(summary.date)) : ''
  if (!ymd) return ''
  const amountAbs = Math.abs(Number(summary.amount) || 0)
  const won = `₩${amountAbs.toLocaleString('ko-KR')}`
  const parts = [ymd, summary.memo, String(summary.detail_memo ?? '').trim(), won, summary.category]
    .filter((x) => x != null && String(x).trim() !== '')
  return parts.length ? `${parts.join(', ')}.` : ''
}

/** 원장 "검토 필요" 클릭 → 동일 거래 채팅 블록으로 스크롤할 때 선택 (계정 선택 UI 우선) */
function findChatMessageForLedgerTx(messages, txId) {
  const id = String(txId ?? '')
  if (!id) return null
  const prefer = ['account_confirm', 'confirm', 'ledger_review']
  for (const tp of prefer) {
    const m = messages.find((x) => x.txId != null && String(x.txId) === id && x.type === tp)
    if (m) return m
  }
  return messages.find((x) => x.txId != null && String(x.txId) === id) ?? null
}

/** GPT가 사용자 원문 전체를 account에 넣는 경우 — 원장 계정명 매칭에 부적합 */
function isLikelySentenceLikeAccountQuery(raw) {
  const s = String(raw || '').trim()
  if (s.length < 18) return false
  const spaces = (s.match(/\s/g) || []).length
  if (spaces >= 2) return true
  if (/(하자|할까|해줘|해주세요|입니까|되나요|인가요|삭제)\??$/u.test(s)) return true
  return s.length >= 40
}

// 로컬 원장 쿼리 (client-side tool 실행)
function runQueryLedger(transactions, args, knownAccountsList = []) {
  const {
    startDate,
    endDate,
    category,
    excludeCategories,
    account,
    merchant,
    location, // query_ledger 호환 파라미터명(의미: 소스/출처 라벨)
    type,
    sortBy = 'date_desc',
    minAmount,
    maxAmount,
    limit = 20,
  } = args
  let results = [...transactions]
  let accountAmbiguous = false
  /** GPT 인자가 계정명이 아니라 문장으로 들어온 경우 fuzzy 매칭을 건너뜀 */
  let accountQueryIgnoredSentenceLike = false
  /** @type {string[]} */
  let ambiguousAccounts = []

  const hasCategoryHint = String(category || '').trim().length > 0
  const hasMerchantHint = String(merchant || '').trim().length > 0
  const categoryIsKnown =
    hasCategoryHint && transactions.some((tx) => fuzzyCategoryMatch(tx.category, category))
  const shouldTreatCategoryAsMerchantKeyword =
    hasCategoryHint && !hasMerchantHint && !categoryIsKnown

  const { effectiveLocation, strippedMeta: locationIgnoredAsMeta, locationRaw } = sanitizeQueryLedgerLocation(location)
  if (effectiveLocation) {
    results = results.filter(
      (tx) =>
        fuzzySourceMatch(tx.location, effectiveLocation) || fuzzySourceMatch(tx.source, effectiveLocation),
    )
  }
  if (startDate) results = results.filter((tx) => normalizeDate(tx.date) >= startDate)
  if (endDate)   results = results.filter((tx) => normalizeDate(tx.date) <= endDate)
  if (type === 'expense') results = results.filter((tx) => tx.amount < 0)
  if (type === 'income')  results = results.filter((tx) => tx.amount > 0)
  if (Array.isArray(excludeCategories) && excludeCategories.length > 0) {
    const excl = excludeCategories.map((c) => c.toLowerCase())
    results = results.filter((tx) => !excl.some((e) => tx.category?.toLowerCase().includes(e)))
  }
  if (category && !shouldTreatCategoryAsMerchantKeyword) {
    results = results.filter((tx) => fuzzyCategoryMatch(tx.category, category))
  }
  if (account) {
    const accQRaw = String(account || '').trim()
    if (!accQRaw) {
      /* skip */
    } else {
      const accQNorm = normalizeLedgerAccountLabel(accQRaw)
      const txAccounts = transactions.map((t) => String(t.account || '').trim()).filter(Boolean)
      const mergedPool = [...new Set([...txAccounts, ...(Array.isArray(knownAccountsList) ? knownAccountsList : []).map((x) => String(x || '').trim()).filter(Boolean)])]
      /** @type string[] — 등록/원장에서 본 문자열 원문 후보 */
      const pool = [...new Set(mergedPool)]

      const exactHit = pool.find((a) => normalizeLedgerAccountLabel(a) === accQNorm)
      if (exactHit) {
        const exactNorm = normalizeLedgerAccountLabel(exactHit)
        results = results.filter((tx) => normalizeLedgerAccountLabel(tx.account) === exactNorm)
      } else {
        const accHits = pool.filter((a) => fuzzyTextMatch(a, accQRaw))
        if (accHits.length >= 2) {
          accountAmbiguous = true
          ambiguousAccounts = [...accHits.slice(0, 20)].sort((a, b) => a.localeCompare(b, 'ko'))
          results = []
        } else if (accHits.length === 1) {
          const onlyNorm = normalizeLedgerAccountLabel(accHits[0])
          results = results.filter((tx) => normalizeLedgerAccountLabel(tx.account) === onlyNorm)
        } else if (isLikelySentenceLikeAccountQuery(accQRaw)) {
          accountQueryIgnoredSentenceLike = true
          // 문장형 검색어는 원장 account 필드에 대한 포함 매칭을 하지 않음 (오탐 방지)
        } else {
          results = results.filter((tx) => fuzzyTextMatch(tx.account, accQRaw))
        }
      }
    }
  }
  if (merchant) {
    results = results.filter(
      (tx) => fuzzyTextMatch(tx.name, merchant) || fuzzyTextMatch(tx.merchant, merchant),
    )
  }
  if (shouldTreatCategoryAsMerchantKeyword) {
    // 모델이 "헬스장" 같은 상호 키워드를 category로 넣는 경우를 흡수한다.
    results = results.filter((tx) => merchantKeywordMatch(tx, category))
  }
  if (minAmount != null) results = results.filter((tx) => Math.abs(tx.amount) >= minAmount)
  if (maxAmount != null) results = results.filter((tx) => Math.abs(tx.amount) <= maxAmount)

  const sorted = results.sort((a, b) => {
    if (sortBy === 'amount_desc') return Math.abs(b.amount) - Math.abs(a.amount)
    if (sortBy === 'amount_asc')  return Math.abs(a.amount) - Math.abs(b.amount)
    if (sortBy === 'date_asc')    return normalizeDate(a.date).localeCompare(normalizeDate(b.date))
    return normalizeDate(b.date).localeCompare(normalizeDate(a.date)) // date_desc
  })

  const maxReturn = Math.min(Number(limit) || 20, 100)
  const capped = sorted.slice(0, maxReturn)
  const mapped = capped.map((tx) => ({
    id: tx.id,
    date: normalizeDate(tx.date),
    name: tx.name || tx.merchant || '(이름 없음)',
    amount: tx.amount,
    category: tx.category || '미분류',
    account: tx.account || '',
    status: tx.status,
  }))

  const totalMatched = sorted.length
  const totalSumSigned = sorted.reduce((s, t) => s + Number(t.amount), 0)
  const totalSumAbs = Math.abs(totalSumSigned)

  /** `transactions`는 응답 크기 제한용 샘플 — 집계·원장 필터는 전체 매칭 기준 */
  const allMatchingIds = sorted.map((t) => String(t.id))

  const appliedFiltersEcho = {
    location: effectiveLocation ?? null,
    ...(locationIgnoredAsMeta && locationRaw ? { locationOmittedWasMetaPhrase: locationRaw } : {}),
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    category: category ?? null,
    merchant: merchant ?? null,
    account: accountQueryIgnoredSentenceLike ? null : account ?? null,
    ...(accountQueryIgnoredSentenceLike ? { accountIgnoredAsSentenceLike: true } : {}),
    type: type ?? null,
  }

  // GPT가 필터가 너무 좁은지 판단할 수 있도록 DB 전체 현황도 함께 반환
  const allDates = transactions.map((t) => normalizeDate(t.date)).filter(Boolean).sort()
  return {
    count: totalMatched,
    totalSumAbs,
    returnedCount: mapped.length,
    truncated: totalMatched > mapped.length,
    allMatchingIds,
    accountAmbiguous,
    locationIgnoredAsMeta,
    ...(ambiguousAccounts.length > 0 ? { ambiguousAccounts } : {}),
    appliedFiltersEcho,
    transactions: mapped,
    ...(accountQueryIgnoredSentenceLike ? { accountQueryIgnoredSentenceLike: true } : {}),
    _db: {
      totalTransactions: transactions.length,
      dateRange: allDates.length
        ? `${allDates[0]} ~ ${allDates[allDates.length - 1]}`
        : '데이터 없음',
      categories: [...new Set(transactions.map((t) => t.category).filter(Boolean))],
    },
  }
}

export default function AIChatPanel() {
  const {
    messages,
    transactions,
    knownAccounts,
    confirmTransaction,
    confirmTransactionAccount,
    completeTransactionReview,
    askAboutTransaction,
    isProcessing,
    acknowledgeAlert,
    resolveLedgerReview,
    addChatMessage,
    updateTransactionInline,
    deleteLine,
    addLedgerEntry,
    resolveLedgerDeleteConfirmMessage,
  } = useVaultStore()
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const setAiFilter = useUIStore((s) => s.setAiFilter)
  const setVizFilter = useUIStore((s) => s.setVizFilter)
  const clearVizFilter = useUIStore((s) => s.clearVizFilter)
  const ledgerChatScrollRequest = useUIStore((s) => s.ledgerChatScrollRequest)
  const clearLedgerChatScrollRequest = useUIStore((s) => s.clearLedgerChatScrollRequest)
  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLabel, setThinkingLabel] = useState('생각하는 중...')
  // 채팅 메시지 스크롤 컨테이너 ref
  const msgContainerRef = useRef(null)
  // 우측 지기 패널: 원장에서 넘긴 해당 메시지 짧게 강조(입체·반짝)
  const spotlightClearTimerRef = useRef(null)
  const [ledgerSpotlightMsgId, setLedgerSpotlightMsgId] = useState(null)
  // OpenAI 대화 히스토리 (세션 내 유지, 미영속)
  const conversationRef = useRef([])
  /** 이번 사용자 질문 턴에서 query_ledger 등으로 모은 원장 ID 스냅샷(턴 시작 시 null) */
  const pendingLedgerBrowseRef = useRef(null)
  /** delete_ledger → 즉시 삭제하지 않고 확인 칩용으로 모음 */
  const pendingLedgerDeletesRef = useRef([])
  // 이전 메시지 수 추적
  const prevMsgCountRef = useRef(messages.length)

  // ── KakaoTalk 스타일: 마지막 N개만 렌더, 스크롤 위로 시 이전 대화 로드 ──────
  const INITIAL_LOAD = 30
  const LOAD_MORE = 20
  const [displayCount, setDisplayCount] = useState(INITIAL_LOAD)
  const prevScrollHeightRef = useRef(null)
  const loadingMoreRef = useRef(false)

  // 헤더에 표시할 날짜 (현재 뷰포트 최상단 메시지 기준)
  const [headerDate, setHeaderDate] = useState(() => {
    const last = messages[messages.length - 1]
    return last ? formatDateLabel(last.createdAt || new Date().toISOString()) : ''
  })

  // 마운트 시점 메시지 ID 기록 → 기존 메시지는 애니메이션 없이 표시
  const initialMsgIdsRef = useRef(null)
  if (initialMsgIdsRef.current === null) {
    initialMsgIdsRef.current = new Set(messages.map((m) => m.id))
  }

  const totalMsgCount = messages.length
  const sliceStart = Math.max(0, totalMsgCount - displayCount)
  const visibleMessages = messages.slice(sliceStart)
  const hasOlderMessages = sliceStart > 0

  // 채팅 하단 스크롤
  const scrollChatToBottom = useCallback((smooth = true) => {
    const el = msgContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  // 뷰포트 최상단 메시지의 날짜를 헤더에 반영
  const syncHeaderDate = useCallback(() => {
    const container = msgContainerRef.current
    if (!container) return
    const els = container.querySelectorAll('[data-msg-date]')
    const containerTop = container.getBoundingClientRect().top
    for (const el of els) {
      if (el.getBoundingClientRect().top >= containerTop) {
        const d = el.getAttribute('data-msg-date')
        if (d) setHeaderDate(d)
        return
      }
    }
  }, [])

  // 초기 마운트: 빈 DOM일 수 있어 보조만
  useEffect(() => {
    scrollChatToBottom(false)
    requestAnimationFrame(() => syncHeaderDate())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // IndexedDB 등으로 메시지가 늦게 들어온 뒤에도 맨 아래로 (새로고침·앱 진입)
  useLayoutEffect(() => {
    if (messages.length === 0) return
    const run = () => {
      scrollChatToBottom(false)
      syncHeaderDate()
    }
    run()
    const id = requestAnimationFrame(() => {
      run()
      requestAnimationFrame(run)
    })
    return () => cancelAnimationFrame(id)
  }, [messages.length, scrollChatToBottom, syncHeaderDate])

  useEffect(() => {
    return () => {
      if (spotlightClearTimerRef.current) {
        window.clearTimeout(spotlightClearTimerRef.current)
      }
    }
  }, [])
  // 원장에서 "검토 필요" 거래 클릭 시 → 해당 메시지 로드 분량 확장 후, 입력 바로 위에 맞춤 + 짧게 강조
  useLayoutEffect(() => {
    if (!ledgerChatScrollRequest) return
    const { txId } = ledgerChatScrollRequest
    const target = findChatMessageForLedgerTx(messages, txId)
    if (!target) {
      clearLedgerChatScrollRequest()
      return
    }
    const idx = messages.findIndex((m) => m.id === target.id)
    if (idx < 0) {
      clearLedgerChatScrollRequest()
      return
    }
    const needCount = messages.length - idx
    if (displayCount < needCount) {
      setDisplayCount(needCount)
      return
    }
    const messageId = target.id
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const root = msgContainerRef.current
        if (!root) {
          clearLedgerChatScrollRequest()
          return
        }
        const el = root.querySelector(`[data-chat-msg-id="${String(messageId)}"]`)
        if (el) {
          el.scrollIntoView({ block: 'end', behavior: 'smooth' })
          if (spotlightClearTimerRef.current) {
            window.clearTimeout(spotlightClearTimerRef.current)
          }
          setLedgerSpotlightMsgId(messageId)
          spotlightClearTimerRef.current = window.setTimeout(() => {
            setLedgerSpotlightMsgId(null)
            spotlightClearTimerRef.current = null
          }, 7400)
          syncHeaderDate()
        }
        clearLedgerChatScrollRequest()
      })
    })
  }, [
    ledgerChatScrollRequest,
    messages,
    displayCount,
    clearLedgerChatScrollRequest,
    syncHeaderDate,
  ])

  // load more 후 스크롤 위치 복원
  useEffect(() => {
    if (loadingMoreRef.current && prevScrollHeightRef.current !== null) {
      const el = msgContainerRef.current
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = null
      loadingMoreRef.current = false
      syncHeaderDate()
    }
  }, [displayCount, syncHeaderDate])

  // 새 메시지 추가 시 하단 스크롤 (load more 중엔 제외)
  useEffect(() => {
    const isNewMessage = messages.length > prevMsgCountRef.current
    prevMsgCountRef.current = messages.length
    if (!loadingMoreRef.current && (isNewMessage || isThinking)) {
      scrollChatToBottom(isNewMessage)
    }
  }, [messages, isThinking, scrollChatToBottom])

  // 스크롤 이벤트: 이전 대화 로드 + 헤더 날짜 업데이트
  const handleMsgScroll = useCallback(() => {
    const el = msgContainerRef.current
    if (!el) return
    // 헤더 날짜 실시간 업데이트
    syncHeaderDate()
    // 맨 위 근처면 이전 대화 추가 로드
    if (!loadingMoreRef.current && hasOlderMessages && el.scrollTop < 60) {
      prevScrollHeightRef.current = el.scrollHeight
      loadingMoreRef.current = true
      setDisplayCount((prev) => Math.min(prev + LOAD_MORE, totalMsgCount))
    }
  }, [hasOlderMessages, totalMsgCount, syncHeaderDate])

  // ─── 클라이언트 사이드 Tool 실행 ───────────────────────────────────────────
  const executeTool = useCallback(
    async (toolName, args) => {
      if (toolName === 'query_ledger') {
        const retryPlan = buildQueryRetryPlan(args)
        let chosenResult = null
        let chosenStep = null
        const attempts = []

        for (let idx = 0; idx < retryPlan.length; idx += 1) {
          const step = retryPlan[idx]
          if (idx > 0 && step.loadingLabel) setThinkingLabel(step.loadingLabel)
          const result = runQueryLedger(transactions, step.args, knownAccounts)
          attempts.push({
            label: step.label,
            filters: formatQueryFilterSummary(step.args),
            count: result.count,
          })
          if (result.accountAmbiguous) {
            chosenResult = result
            chosenStep = step
            break
          }
          if (result.count > 0 || idx === retryPlan.length - 1) {
            chosenResult = result
            chosenStep = step
            break
          }
        }

        const result = chosenResult || runQueryLedger(transactions, args, knownAccounts)
        const sumDisplay = (result.totalSumAbs ?? 0).toLocaleString('ko-KR')

        const toolArgs = chosenStep?.args ?? args
        const hasOtherNarrowing = Boolean(
          toolArgs?.startDate ||
            toolArgs?.endDate ||
            (toolArgs?.category && String(toolArgs.category).trim()) ||
            (toolArgs?.merchant && String(toolArgs.merchant).trim()) ||
            (toolArgs?.location && String(toolArgs.location).trim() && !result.locationIgnoredAsMeta),
        )
        const trivialFullLedger =
          Boolean(result.accountQueryIgnoredSentenceLike) &&
          result.count === transactions.length &&
          transactions.length > 0 &&
          !hasOtherNarrowing

        // 결과가 있으면 원장 UI를 즉시 필터링 (전체 매칭 ID — limit 샘플과 동일 집합)
        if (
          result.count > 0 &&
          Array.isArray(result.allMatchingIds) &&
          result.allMatchingIds.length > 0 &&
          !trivialFullLedger
        ) {
          const ids = new Set(result.allMatchingIds)
          const omitLoc = result.locationIgnoredAsMeta && result.appliedFiltersEcho?.locationOmittedWasMetaPhrase
          const parts = [
            toolArgs.startDate && toolArgs.endDate ? `${toolArgs.startDate} ~ ${toolArgs.endDate}` : null,
            !omitLoc && toolArgs.location ? String(toolArgs.location) : null,
            result.accountQueryIgnoredSentenceLike ? null : toolArgs.account ? String(toolArgs.account) : null,
            toolArgs.category || null,
            toolArgs.merchant || null,
          ].filter(Boolean)
          const label = parts.join(' · ') || 'AI 검색 결과'
          setAiFilter({ label, ids })
          pendingLedgerBrowseRef.current = {
            label,
            transactionIds: [...result.allMatchingIds],
          }
        }

        const truncNote =
          result.truncated && result.returnedCount != null
            ? ` 응답 transactions는 상위 ${result.returnedCount}건 샘플이며, count·totalSumAbs는 전체 매칭 기준이다.`
            : ''

        let ledgerSummary
        if (result.accountAmbiguous && result.ambiguousAccounts?.length) {
          ledgerSummary = `계정 검색어가 등록된 여러 계정에 동시에 걸렸습니다: ${result.ambiguousAccounts.join(', ')}. 0건으로 처리 — 사용자에게 정확한 계정명(목록 중 하나)을 물어라.`
        } else if (result.count === 0) {
          ledgerSummary = `조회 결과 0건입니다. 시도한 조건: ${attempts.map((a) => `${a.label}(${a.filters})`).join(' → ')}. (DB 총 ${result._db.totalTransactions}건, 기간: ${result._db.dateRange}, 카테고리: ${result._db.categories.join(', ')})`
        } else {
          const metaLocNote = result.locationIgnoredAsMeta
            ? ' 원장 전체 의미로 들어온 location(예: 가계부/원장 명칭)은 소스 필터에서 빼았으니, 답변에 "가계부 소스에만"이라고 거짓으로 한정하지 말 것.'
            : ''
          const accountIgnNote = result.accountQueryIgnoredSentenceLike
            ? ' account 파라미터가 문장처럼 길어 계정 필터에는 적용하지 않았음(appliedFiltersEcho.accountIgnoredAsSentenceLike). merchant·category·기간·location 등으로 다시 좁혀 조회하라.'
            : ''
          const trivialNote =
            trivialFullLedger && result.accountQueryIgnoredSentenceLike
              ? ' 다른 좁히기 조건이 없어 원장 전체와 같은 결과였으며 AI 검색 하이라이트는 적용하지 않았다.'
              : ''
          ledgerSummary = `총 ${result.count}건, 합계 ₩${sumDisplay}.${truncNote} 답변의 건수·합계는 이 summary와 반드시 일치해야 하며, appliedFiltersEcho의 account가 비었으면 유저에게 말한 결제수단·계정을 단정하지 마라.${metaLocNote}${accountIgnNote}${trivialNote}`
        }

        return {
          ...result,
          attempt_count: attempts.length,
          attempts,
          summary: ledgerSummary,
        }
      }

      if (toolName === 'analyze_category_spending') {
        const { startDate, endDate, excludeCategories: excl = [], type: txType = 'expense', topN = 5 } = args

        // 1) 기간·타입 필터
        let pool = [...transactions]
        if (startDate) pool = pool.filter((t) => normalizeDate(t.date) >= startDate)
        if (endDate)   pool = pool.filter((t) => normalizeDate(t.date) <= endDate)
        // 분석은 기본적으로 지출(음수) 기준
        if (txType === 'income') pool = pool.filter((t) => t.amount > 0)
        else {
          pool = pool.filter((t) => t.amount < 0)
          // 상환(카드대금·대출)은 "소비" 순위에서 제외 — 이자/금융수수료는 포함
          pool = pool.filter((t) => isConsumptiveLedgerExpense(t))
        }

        // 2) 제외 카테고리 필터
        if (excl.length > 0) {
          const exclLower = excl.map((c) => c.toLowerCase())
          pool = pool.filter((t) => !exclLower.some((e) => t.category?.toLowerCase().includes(e)))
        }

        // 3) JS로 카테고리별 합산 (절댓값) — LLM에게 수학 맡기지 않음
        const categoryMap = pool.reduce((acc, t) => {
          const cat = t.category || '미분류'
          acc[cat] = (acc[cat] || 0) + Math.abs(t.amount)
          return acc
        }, {})

        const ranked = Object.entries(categoryMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, topN)
          .map(([category, total], idx) => ({ rank: idx + 1, category, total }))

        const topCategory = ranked[0]?.category ?? null
        const topAmount   = ranked[0]?.total ?? 0

        // 4) 1위 카테고리를 원장 UI에 자동 표시
        if (topCategory) {
          const ids = new Set(
            pool.filter((t) => t.category === topCategory).map((t) => t.id),
          )
          setAiFilter({ label: topCategory, ids })
          pendingLedgerBrowseRef.current = {
            label: topCategory,
            transactionIds: pool.filter((t) => t.category === topCategory).map((t) => String(t.id)),
          }
        }

        return {
          topCategory,
          topAmount,
          ranking: ranked,
          totalTransactionsAnalyzed: pool.length,
          note: '이 데이터는 클라이언트 JS가 직접 계산한 결과입니다. 수치를 그대로 읽어 브리핑하세요.',
        }
      }

      if (toolName === 'update_ledger') {
        const { txId, category, account } = args
        const target = transactions.find((t) => t.id === String(txId))
        if (!target) return { success: false, error: `ID ${txId}인 거래를 찾을 수 없습니다.` }
        const patch = {}
        if (category != null && String(category).trim()) {
          patch.category = String(category).trim()
        }
        if (account != null) {
          patch.account = String(account).trim()
        }
        if (Object.keys(patch).length === 0) {
          return { success: false, error: 'category 또는 account 중 하나는 필요합니다.' }
        }
        await updateTransactionInline(String(txId), patch)
        return {
          success: true,
          txId,
          previousCategory: target.category,
          newCategory: patch.category ?? target.category,
          newAccount: patch.account,
        }
      }

      if (toolName === 'delete_ledger') {
        const txId = String(args.txId || '').trim()
        if (!txId) return { success: false, error: 'txId가 필요합니다.' }
        const target = transactions.find((t) => t.id === txId)
        if (!target) return { success: false, error: `ID ${txId}인 거래를 찾을 수 없습니다.` }
        pendingLedgerDeletesRef.current.push({
          txId,
          date: normalizeDate(target.date),
          name: target.name || target.merchant || '(이름 없음)',
          amount: target.amount,
          category: target.category || '미분류',
        })
        return {
          success: true,
          user_confirmation_pending: true,
          txId,
          preview: {
            date: normalizeDate(target.date),
            name: target.name || target.merchant || '(이름 없음)',
            amount: target.amount,
            category: target.category || '미분류',
          },
          note: '실제 삭제는 채팅에 표시된 확인 영역에서 **예**를 눌러야 적용된다. 자연어 답변에서는 "삭제했다"고 하지 말고 확인 칩을 누르라고 안내하라. 최종 삭제 건수는 예 클릭 후 사용자에게 보이는 건수와 반드시 같아야 한다.',
        }
      }

      if (toolName === 'add_ledger_entry') {
        const type = args.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
        const out = await addLedgerEntry({
          type,
          category: String(args.category ?? '').trim() || '기타',
          amount: Number(args.amount),
          date: String(args.date ?? '').trim(),
          summary: String(
            args.summary != null && String(args.summary).trim()
              ? args.summary
              : args.memo != null
                ? args.memo
                : '',
          ).trim() || '내용',
          detail_memo: String(args.detail_memo ?? '').trim() || undefined,
          account: String(args.account ?? '').trim() || undefined,
        })
        if (!out.success) return out
        const needAccount = !String(args.account ?? '').trim()
        const factLine = needAccount ? formatNeedAccountFactLine(out.summary) : ''
        const clarifyNote = factLine
          ? '【필수】`fact_line` 을 **첫째 줄**에 그대로 쓰고, **둘째 줄**에만 현금·카드(또는 이체/통장)를 묻는다. "날짜는 확인"·"적요·금액은 확인" 같은 **추상 멘트 금지**.'
          : '【필수】`summary` (날짜·memo=적요·detail_memo·amount·category)로 `YYYY-MM-DD, 적요, (메모), ₩, 카테고리.` 한 줄을 **첫째 줄**에 쓰고, **둘째 줄**에만 결제수단을 묻는다. 추상 "확인" 멘트 금지.'
        return {
          success: true,
          ...out,
          need_account_clarify: needAccount,
          ...(needAccount && factLine ? { fact_line: factLine } : {}),
          note: needAccount
            ? clarifyNote
            : '클라이언트에 원장이 반영되었습니다. summary로 사용자에게 보고하라.',
        }
      }

      if (toolName === 'render_visualization') {
        const { startDate, endDate, label } = args
        if (startDate && endDate) {
          setVizFilter({ startDate, endDate, label: label || `${startDate} ~ ${endDate}` })
        } else {
          clearVizFilter()
        }
        openVizMode()
        return { success: true, message: `${label || '지정 기간'} 지출 분석 화면을 열었습니다.` }
      }

      return { error: `알 수 없는 도구: ${toolName}` }
    },
    [transactions, updateTransactionInline, addLedgerEntry, setAiFilter, openVizMode, setVizFilter, clearVizFilter, knownAccounts],
  )

  const handleLedgerDeleteDecision = useCallback(
    async (msg, accepted) => {
      const items = dedupeLedgerDeleteItems(msg.ledgerDeleteConfirm?.items ?? [])
      const n = items.length
      if (accepted) {
        for (const it of items) {
          await deleteLine(it.txId)
        }
        addChatMessage({
          role: 'ai',
          type: 'text',
          text: `요청하신 대로 총 ${n}건을 원장에서 삭제했습니다.`,
        })
        conversationRef.current.push({ role: 'user', content: '[삭제 확인] 예' })
        conversationRef.current.push({ role: 'assistant', content: `삭제 완료: ${n}건 처리했습니다.` })
      } else {
        addChatMessage({
          role: 'ai',
          type: 'text',
          text: '삭제를 취소했습니다.',
        })
        conversationRef.current.push({ role: 'user', content: '[삭제 확인] 아니오' })
        conversationRef.current.push({ role: 'assistant', content: '삭제를 취소했습니다.' })
      }
      resolveLedgerDeleteConfirmMessage(msg.id)
    },
    [deleteLine, addChatMessage, resolveLedgerDeleteConfirmMessage],
  )

  // ─── AI 채팅 멀티턴 루프 ───────────────────────────────────────────────────
  const executeAiChat = useCallback(
    async (userText) => {
      // 1) 유저 메시지 UI 추가 + 히스토리에 기록
      addChatMessage({ role: 'user', type: 'text', text: userText })
      conversationRef.current.push({ role: 'user', content: userText })
      pendingLedgerBrowseRef.current = null
      pendingLedgerDeletesRef.current = []

      setIsThinking(true)
      setThinkingLabel('생각하는 중...')

      try {
        let safetyBreaker = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (++safetyBreaker > 6) throw new Error('응답 루프가 너무 깁니다.')

          // 매 요청마다 현재 원장 DB 현황을 함께 전송 (GPT가 계정·카테고리를 정확히 알게)
          const allDates = transactions.map((t) => normalizeDate(t.date)).filter(Boolean).sort()
          const dbContext = {
            accounts: knownAccounts,
            categories: [...new Set(transactions.map((t) => t.category).filter(Boolean))],
            totalTransactions: transactions.length,
            dateRange: allDates.length
              ? `${allDates[0]} ~ ${allDates[allDates.length - 1]}`
              : '데이터 없음',
          }

          const res = await fetch(resolveApiUrl('/api/chat-assistant'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: conversationRef.current, dbContext }),
          })

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            throw new Error(errData?.error || `서버 오류 (${res.status})`)
          }

          const data = await res.json()

          // 2) GPT가 Tool Call을 요청한 경우 → 로컬에서 실행
          if (data.type === 'tool_call') {
            conversationRef.current.push(data.assistantMessage)

            for (const call of data.calls) {
              const toolName = call.function.name
              let args
              try { args = JSON.parse(call.function.arguments) } catch { args = {} }

              if (toolName === 'query_ledger') setThinkingLabel('금고를 뒤져보는 중...')
              else if (toolName === 'update_ledger') setThinkingLabel('원장을 수정하는 중...')
              else if (toolName === 'delete_ledger') setThinkingLabel('삭제 확인 준비 중...')
              else if (toolName === 'add_ledger_entry') setThinkingLabel('가계부에 기록하는 중...')
              else if (toolName === 'render_visualization') setThinkingLabel('시각화를 여는 중...')

              const toolResult = await executeTool(toolName, args)

              conversationRef.current.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolResult),
              })
            }
            if (pendingLedgerDeletesRef.current.length > 0) {
              const items = dedupeLedgerDeleteItems(pendingLedgerDeletesRef.current)
              pendingLedgerDeletesRef.current = []
              addChatMessage({
                role: 'ai',
                type: 'ledger_delete_confirm',
                text: `아래 ${items.length}건을 원장에서 삭제할까요? 예를 누르기 전까지는 삭제되지 않습니다.`,
                ledgerDeleteConfirm: { items },
              })
            }
            // 결과 보내고 다시 GPT 호출 (루프 継続)
            setThinkingLabel('답변을 정리하는 중...')
            continue
          }

          // 3) 최종 텍스트 답변
          if (data.type === 'reply') {
            // [WINNER_CATEGORY:카테고리명] 태그 파싱 → aiFilter 업데이트
            const winnerMatch = data.text.match(/\[WINNER_CATEGORY:([^\]]+)\]/)
            if (winnerMatch) {
              const winnerCategory = winnerMatch[1].trim()
              const ids = new Set(
                transactions
                  .filter((t) => t.category?.toLowerCase().includes(winnerCategory.toLowerCase()))
                  .map((t) => t.id),
              )
              if (ids.size > 0) {
                setAiFilter({ label: winnerCategory, ids })
                pendingLedgerBrowseRef.current = {
                  label: winnerCategory,
                  transactionIds: Array.from(ids, (id) => String(id)),
                }
              }
            }
            // 태그를 제거한 깔끔한 텍스트만 채팅에 표시
            const cleanText = data.text.replace(/\s*\[WINNER_CATEGORY:[^\]]+\]/g, '').trim()
            const browse = pendingLedgerBrowseRef.current
            const ledgerBrowseSnapshot =
              browse &&
              Array.isArray(browse.transactionIds) &&
              browse.transactionIds.length > 0 &&
              browse.label
                ? { label: browse.label, transactionIds: [...browse.transactionIds] }
                : undefined
            addChatMessage({
              role: 'ai',
              type: 'text',
              text: cleanText,
              ...(ledgerBrowseSnapshot ? { ledgerBrowseSnapshot } : {}),
            })
            conversationRef.current.push({ role: 'assistant', content: data.text })
            break
          }

          throw new Error('알 수 없는 응답 형식입니다.')
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '답변 중 오류가 발생했습니다.'
        addChatMessage({ role: 'ai', type: 'text', text: `죄송합니다. ${msg}` })
      } finally {
        setIsThinking(false)
        setThinkingLabel('생각하는 중...')
      }
    },
    [addChatMessage, executeTool],
  )

  // executeAiChat가 의존성으로 바뀌어도 composer는 리렌더·IME 충돌이 없게 항상 동일한 콜백 참조만 전달
  const onSendHandlerRef = useRef(executeAiChat)
  onSendHandlerRef.current = executeAiChat
  const stableOnSend = useCallback((t) => onSendHandlerRef.current(t), [])

  return (
    <aside
      className={`${CHAT_PANEL_ASIDE_LAYOUT} bg-surface-container-lowest/80 backdrop-blur-xl rounded-t-3xl rounded-b-2xl shadow-2xl border border-surface-container/30`}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-container">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-md shadow-primary/20">
                <span className="material-symbols-outlined text-white text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  smart_toy
                </span>
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-surface-container-lowest rounded-full ${isProcessing ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`} />
            </div>
            <h2 className="text-[15px] font-bold text-on-surface">금고 AI비서</h2>
          </div>
          {/* 현재 뷰포트 최상단 메시지 날짜 */}
          {headerDate && (
            <span className="text-xs text-on-surface-variant font-medium shrink-0">{headerDate}</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={msgContainerRef}
        onScroll={handleMsgScroll}
        className="flex-grow overflow-y-auto px-3 py-2 text-sm chat-panel-scrollbar"
      >
        {/* 위쪽 이전 대화 로드 표시 */}
        {hasOlderMessages && (
          <div className="text-center py-1">
            <span className="text-[10px] text-outline/50">위로 스크롤하면 이전 대화를 불러옵니다</span>
          </div>
        )}
        {visibleMessages.map((msg, msgIndex) => {
          const animate = !initialMsgIdsRef.current.has(msg.id)
          const msgDate = formatDateLabel(msg.createdAt || new Date().toISOString())
          const spotlight = ledgerSpotlightMsgId != null && String(ledgerSpotlightMsgId) === String(msg.id)
          const prevMsg = msgIndex > 0 ? visibleMessages[msgIndex - 1] : null
          const turnAfterPrev =
            msgIndex === 0
              ? ''
              : chatMessageStartsNewSegment(prevMsg, msg)
                ? 'mt-3 border-t border-outline/25 pt-3'
                : 'mt-2'
          return (
            <div
              key={msg.id}
              data-chat-msg-id={msg.id}
              data-msg-date={msgDate}
              className={[
                turnAfterPrev,
                animate ? 'animate-fade-in' : '',
                spotlight ? 'ledger-msg-spotlight-anchor' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <ChatBubble
                spotlight={spotlight}
                msg={msg}
                transactions={transactions}
                knownAccounts={knownAccounts}
                onConfirm={confirmTransaction}
                onAccountConfirm={confirmTransactionAccount}
                onCompleteReview={completeTransactionReview}
                onAcknowledge={acknowledgeAlert}
                onLedgerResolve={resolveLedgerReview}
                onLedgerDeleteDecision={handleLedgerDeleteDecision}
              />
            </div>
          )
        })}

        {/* AI Thinking 버블 */}
        {isThinking && (
          <div className="mt-2 flex items-end gap-1.5 max-w-[94%] animate-fade-in">
            <div className="bg-surface-container-low px-3 py-2 rounded-2xl rounded-tl-none">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-on-surface-variant text-xs font-medium">{thinkingLabel}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <IsolatedChatComposer
        variant="keeper"
        disabled={isThinking}
        thinkingLabel={thinkingLabel}
        idlePlaceholder="금고 AI비서에게 무엇이든 지시하세요. (줄바꿈: Ctrl+Enter)"
        onSend={stableOnSend}
      />
    </aside>
  )
}

// ── 채팅 턴/덩어리 구분: 질+답 묶음 유지 · 끊어진 회차(시간 간격)·새 사용자 질문 ────────
/** createdAt 두 개 모두 파싱 가능할 때 간격(ms) */
function chatMessageGapMs(prev, msg) {
  const ta = prev?.createdAt ? Date.parse(String(prev.createdAt)) : NaN
  const tb = msg?.createdAt ? Date.parse(String(msg.createdAt)) : NaN
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  return tb - ta
}

const NEW_SEGMENT_AI_GAP_MS = 15 * 60 * 1000 // 15분 이상 간격이면 별 회차(ai→ai)

/** 구분선(큰 여백) 직후에 오는 새 말풍선인지 */
function chatMessageStartsNewSegment(prev, msg) {
  if (!prev || !msg) return false
  if (msg.role === 'user' && prev.role === 'ai') return true
  if (prev.role === 'ai' && msg.role === 'ai') {
    const gap = chatMessageGapMs(prev, msg)
    if (gap != null && gap >= NEW_SEGMENT_AI_GAP_MS) return true
  }
  return false
}

// ── 날짜 레이블 포맷 (createdAt ISO → "26년 4월 29일(수)") ─────────────────
function formatDateLabel(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  const yy = String(d.getFullYear()).slice(-2)
  return `${yy}년 ${d.getMonth() + 1}월 ${d.getDate()}일(${days[d.getDay()]})`
}

// ── 버블 옆 타임스탬프 ────────────────────────────────────────────────────────
function TimeStamp({ time }) {
  return (
    <div className="shrink-0 self-end pb-0.5">
      <span className="text-[10px] text-outline leading-tight whitespace-nowrap">{time}</span>
    </div>
  )
}

function aiSpotlightCn(spotlight, className = '') {
  return [className.trim(), spotlight ? 'ledger-msg-spotlight-bubble' : ''].filter(Boolean).join(' ')
}

function LedgerDeleteConfirmBubble({ msg, spotlight, onDecision }) {
  const [busy, setBusy] = useState(false)
  const items = Array.isArray(msg.ledgerDeleteConfirm?.items) ? msg.ledgerDeleteConfirm.items : []
  const resolved = Boolean(msg.resolved)

  return (
    <div className="flex flex-col gap-1 max-w-[94%]">
      <div className="flex items-end gap-1.5">
        <div
          className={aiSpotlightCn(
            spotlight,
            'bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed border border-red-500/25',
          )}
        >
          <p className="font-semibold text-sm whitespace-pre-wrap">{msg.text}</p>
          <ul className="mt-2 max-h-44 overflow-y-auto text-[11px] space-y-1 text-on-surface-variant border-t border-surface-container pt-2">
            {items.map((it, idx) => (
              <li key={it.txId} className="tabular-nums">
                <span className="text-outline">{idx + 1}.</span> {it.date} · {it.name} ·{' '}
                <span className="font-semibold text-on-surface">{fmtLedgerLineAmount(it.amount)}</span> · {it.category}
              </li>
            ))}
          </ul>
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
      </div>
      {!resolved && (
        <div className="flex flex-wrap gap-2 mt-1 ml-1">
          <button
            type="button"
            disabled={busy || !onDecision}
            onClick={async () => {
              if (!onDecision) return
              setBusy(true)
              try {
                await onDecision(msg, true)
              } finally {
                setBusy(false)
              }
            }}
            className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-full hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            예, 삭제
          </button>
          <button
            type="button"
            disabled={busy || !onDecision}
            onClick={async () => {
              if (!onDecision) return
              setBusy(true)
              try {
                await onDecision(msg, false)
              } finally {
                setBusy(false)
              }
            }}
            className="px-3 py-1.5 bg-surface-container text-on-surface-variant text-xs font-bold rounded-full border border-surface-container hover:bg-surface-container-high disabled:opacity-50 transition-colors"
          >
            아니오
          </button>
        </div>
      )}
      {resolved ? (
        <div className="ml-1 mt-1 flex items-center gap-1 text-[11px] text-on-surface-variant">
          <span className="material-symbols-outlined text-sm text-green-600">check_circle</span>
          응답했습니다
        </div>
      ) : null}
    </div>
  )
}

function ChatBubble({
  msg,
  spotlight,
  transactions,
  knownAccounts,
  onConfirm,
  onAccountConfirm,
  onCompleteReview,
  onAcknowledge,
  onLedgerResolve,
  onLedgerDeleteDecision,
}) {
  const setAiFilter = useUIStore((s) => s.setAiFilter)
  const restoreTrinityModeChat = useUIStore((s) => s.restoreTrinityMode)
  const [isCustomInputOpen, setIsCustomInputOpen] = useState(false)
  const [customCategory, setCustomCategory] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [accountInput, setAccountInput] = useState('')
  const tx = msg.txId ? transactions.find((t) => t.id === String(msg.txId)) : null

  // 복원된 메시지에서도 기존 선택값을 복구하고,
  // msg.accountOptions가 비어 있으면 현재 knownAccounts를 fallback으로 사용
  const liveAccountOptions = (() => {
    const msgOpts = Array.isArray(msg.accountOptions) ? msg.accountOptions : []
    if (msgOpts.length > 0) return msgOpts
    return (knownAccounts ?? [])
      .filter(Boolean)
      .map((a) => ({ label: a, category: a }))
  })()

  const sortedAccountChoices = useMemo(() => {
    const opts = Array.isArray(liveAccountOptions) ? liveAccountOptions : []
    const labels = opts
      .map((o) => String(o.category ?? o.label ?? '').trim())
      .filter(Boolean)
    return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [liveAccountOptions])

  const accountChoicesSet = useMemo(() => new Set(sortedAccountChoices), [sortedAccountChoices])

  useEffect(() => {
    if (msg.type !== 'account_confirm') return
    if (!selectedCategory.trim() && tx?.category) {
      setSelectedCategory(tx.category)
    }
    if (!accountInput.trim() && tx?.account) {
      setAccountInput(tx.account)
    }
  }, [accountInput, msg.type, selectedCategory, tx?.account, tx?.category])

  useEffect(() => {
    if (msg.type !== 'account_confirm') return
    const options = Array.isArray(msg.options) ? msg.options : []
    const isLocked = options.length === 1 && options[0]?.category !== '__CUSTOM__'
    if (!isLocked) return
    const only = String(options[0]?.category || '').trim()
    if (!only) return
    if (selectedCategory !== only) setSelectedCategory(only)
  }, [msg.type, msg.options, selectedCategory])

  const submitCustomCategory = () => {
    const next = customCategory.trim()
    if (!next || !msg.txId) return
    onConfirm(String(msg.txId), next)
    setIsCustomInputOpen(false)
    setCustomCategory('')
  }

  if (msg.type === 'processing') {
    return (
        <div className="flex items-end gap-1.5 max-w-[94%]">
        <div className={aiSpotlightCn(spotlight, 'bg-surface-container-low px-3 py-2 rounded-2xl rounded-tl-none')}>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-primary/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-on-surface-variant text-xs">영수증을 분석하고 있습니다...</span>
          </div>
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
      </div>
    )
  }

  if (msg.type === 'result') {
    return (
      <div className="flex items-end gap-1.5 max-w-[94%]">
        <div className={aiSpotlightCn(spotlight, 'bg-primary/5 border border-primary/10 px-3.5 py-2.5 rounded-2xl rounded-tl-none space-y-1.5')}>
          <p className="text-on-surface leading-relaxed font-semibold">{msg.text}</p>
          <div className="pt-1 border-t border-primary/10 flex justify-between items-center text-[11px]">
            <span className="text-on-surface-variant italic">{msg.subtitle}</span>
            <span className="text-primary font-bold tabular-nums">소모: {msg.credit} C</span>
          </div>
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
      </div>
    )
  }

  if (msg.type === 'confirm') {
    const isResolved = msg.resolved || (tx && tx.status === 'CONFIRMED')
    const options = Array.isArray(msg.options) ? msg.options : []
    return (
      <div className="flex flex-col gap-1 max-w-[94%]">
        <div className="flex items-end gap-1.5">
        <div className={aiSpotlightCn(spotlight, 'bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed')}>
          {msg.text}
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
        </div>
        {!isResolved ? (
          <>
            <div className="flex flex-wrap gap-2 mt-1 ml-1">
              {options.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    if (opt.category === '__CUSTOM__') {
                      setIsCustomInputOpen(true)
                      return
                    }
                    onConfirm(String(msg.txId), opt.category)
                  }}
                  className="px-3 py-1.5 bg-primary/5 text-primary text-xs font-bold rounded-lg border border-primary/15 hover:bg-primary hover:text-white transition-all duration-200 active:scale-95"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {isCustomInputOpen && (
              <div className="mt-2 ml-1 flex items-center gap-2">
                <input
                  autoFocus
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCustomCategory()
                    if (e.key === 'Escape') setIsCustomInputOpen(false)
                  }}
                  placeholder="카테고리 한 단어 입력"
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={submitCustomCategory}
                  className="px-3 py-1.5 bg-primary text-white text-xs rounded-lg font-bold"
                >
                  확인
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="ml-1 mt-1 flex items-center gap-1.5 text-[11px] text-green-600 font-medium">
            {tx?.category && (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                {tx.category}
              </span>
            )}
            <span className="material-symbols-outlined text-sm">check_circle</span>
            분류 완료
          </div>
        )}
      </div>
    )
  }

  if (msg.type === 'account_confirm') {
    const isResolved = msg.resolved || (tx?.status === 'CONFIRMED' && Boolean(tx?.account))
    const categoryOptions = Array.isArray(msg.options) ? msg.options : []
    const categoryLocked = categoryOptions.length === 1 && categoryOptions[0]?.category !== '__CUSTOM__'
    const effectiveCategory = categoryLocked
      ? String(categoryOptions[0]?.category || '').trim()
      : selectedCategory.trim()
    const categoryPickOptions = categoryOptions.filter((o) => o.category !== '__CUSTOM__')
    const hasCustomCategoryHint = categoryOptions.some((o) => o.category === '__CUSTOM__')
    const canSubmit = Boolean(effectiveCategory && accountInput.trim() && msg.txId)
    const selectSyncedAccount = accountChoicesSet.has(accountInput.trim()) ? accountInput.trim() : ''
    return (
      <div className="flex w-full max-w-[94%] flex-col gap-1 items-stretch">
        <div className="flex items-end gap-1.5">
        <div className={aiSpotlightCn(spotlight, 'bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed')}>
          {msg.text}
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
        </div>
        {!isResolved ? (
          <>
            {categoryLocked ? (
              <div className="ml-1 mt-1 flex items-center gap-1.5 text-[11px] text-primary font-semibold">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                항목 고정: {effectiveCategory}
              </div>
            ) : (
              <>
                <div className="ml-1 mt-2 text-[11px] leading-tight text-on-surface-variant">
                  <span className="font-semibold">항목</span>{' '}
                  <span className="text-outline/80 font-normal">
                    (과거 유사 거래·추천 — 택 1)
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1 ml-1">
                  {categoryPickOptions.map((opt) => (
                    <button
                      key={`${opt.category}-${opt.label}`}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(opt.category)
                        setIsCustomInputOpen(false)
                        setCustomCategory('')
                      }}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all duration-200 active:scale-95 ${
                        selectedCategory === opt.category
                          ? 'bg-primary text-white border-primary'
                          : 'bg-primary/5 text-primary border-primary/15 hover:bg-primary hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {hasCustomCategoryHint && (
                    <button
                      type="button"
                      onClick={() => setIsCustomInputOpen(true)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border border-dashed transition-all duration-200 active:scale-95 ${
                        isCustomInputOpen
                          ? 'bg-primary text-white border-primary'
                          : 'bg-primary/5 text-primary border-primary/30 hover:bg-primary/15'
                      }`}
                    >
                      직접 입력…
                    </button>
                  )}
                </div>
                {isCustomInputOpen && (
                  <div className="mt-2 ml-1 flex items-center gap-2">
                    <input
                      autoFocus
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const next = customCategory.trim()
                          if (!next) return
                          setSelectedCategory(next)
                          setIsCustomInputOpen(false)
                          setCustomCategory('')
                        }
                        if (e.key === 'Escape') setIsCustomInputOpen(false)
                      }}
                      placeholder="항목 입력 (예: 구독, 식비)"
                      className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = customCategory.trim()
                        if (!next) return
                        setSelectedCategory(next)
                        setIsCustomInputOpen(false)
                      }}
                      className="px-3 py-1.5 bg-primary text-white text-xs rounded-lg font-bold"
                    >
                      확인
                    </button>
                  </div>
                )}
              </>
            )}
            <div className="mt-3 ml-1 flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
              <label htmlFor={`acct-pick-${msg.id}`} className="sr-only">
                목록에서 계정 선택
              </label>
              <select
                id={`acct-pick-${msg.id}`}
                value={selectSyncedAccount}
                onChange={(e) => setAccountInput(String(e.target.value))}
                disabled={sortedAccountChoices.length === 0}
                className="min-w-[11rem] shrink-0 truncate rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-1.5 text-xs font-semibold text-primary shadow-sm focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[12rem]"
              >
                <option value="">목록에서 계정 선택</option>
                {sortedAccountChoices.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <div className="flex min-w-0 flex-1 basis-0 grow items-center gap-2">
                <input
                  value={accountInput}
                  onChange={(e) => setAccountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit) {
                      onCompleteReview(String(msg.txId), effectiveCategory, accountInput.trim())
                    }
                  }}
                  placeholder="새 계정명 입력"
                  className="min-w-0 flex-1 px-3 py-1.5 text-xs rounded-lg border border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => onCompleteReview(String(msg.txId), effectiveCategory, accountInput.trim())}
                  disabled={!canSubmit}
                  className="shrink-0 px-3 py-1.5 bg-primary text-white text-xs rounded-lg font-bold disabled:opacity-50"
                >
                  확인
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="ml-1 mt-1 flex items-center gap-1.5 text-[11px] text-green-600 font-medium">
            {tx?.category ? (
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                {tx.category}
              </span>
            ) : null}
            <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
              {tx?.account || '계정 확인'}
            </span>
            <span className="material-symbols-outlined text-sm">check_circle</span>
            항목/계정 반영 완료
          </div>
        )}
      </div>
    )
  }

  if (msg.type === 'alert') {
    return (
      <div className="flex flex-col gap-1 max-w-[94%]">
        <div className="flex items-end gap-1.5">
        <div
          className={aiSpotlightCn(
            spotlight,
            `px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed border ${
              msg.resolved
                ? 'bg-surface-container-low border-surface-container'
                : 'bg-gradient-to-r from-[#FFD700] via-[#FFEA70] to-[#F1C40F] border-[#FFD700]/80 alert-gold-glow'
            }`,
          )}
        >
          <p className={`${msg.resolved ? 'text-on-surface' : 'text-[#121212]'} font-semibold`}>{msg.text}</p>
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
        </div>
        {!msg.resolved && (
          <div className="flex flex-wrap gap-2 mt-1 ml-1">
            {(msg.options || ['롸져!', '확인']).map((opt) => (
              <button
                key={opt}
                onClick={() => onAcknowledge(msg.id, opt)}
                className="px-3 py-1.5 bg-gradient-to-r from-[#FFD700]/25 via-[#FFEA70]/20 to-[#F1C40F]/25 text-[#735A00] text-xs font-bold rounded-lg border border-[#FFD700]/70 shadow-[0_0_10px_rgba(255,215,0,0.25)] hover:shadow-[0_0_16px_rgba(255,215,0,0.45)] hover:bg-[#FFD700] hover:text-[#121212] transition-all duration-200 active:scale-95"
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (msg.type === 'ledger_review') {
    return (
      <div className="flex flex-col gap-1 max-w-[94%]">
        <div className="flex items-end gap-1.5">
        <div className={aiSpotlightCn(spotlight, 'bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed border border-primary/15')}>
          <p className="font-semibold">{msg.text}</p>
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
        </div>
        {!msg.resolved && (
          <div className="flex flex-wrap gap-2 mt-1 ml-1">
            {(msg.options || []).map((opt) => (
              <button
                key={opt.label}
                onClick={() => onLedgerResolve(msg.id, msg.ledgerTxId, opt.category)}
                className="px-3 py-1.5 bg-primary/5 text-primary text-xs font-bold rounded-lg border border-primary/20 hover:bg-primary hover:text-white transition-all duration-200 active:scale-95"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {msg.resolved && (
          <div className="ml-1 mt-1 flex items-center gap-1.5 text-[11px] text-green-600 font-medium">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            챗봇에서 분류 반영 완료
          </div>
        )}
      </div>
    )
  }

  if (msg.type === 'ledger_delete_confirm') {
    return <LedgerDeleteConfirmBubble msg={msg} spotlight={spotlight} onDecision={onLedgerDeleteDecision} />
  }

  if (msg.role === 'user') {
    return (
      <div className="flex items-end justify-end gap-1.5 ml-auto max-w-[94%]">
        <TimeStamp time={msg.time} />
        <div className="bg-primary text-white px-3.5 py-2 rounded-2xl rounded-tr-none shadow-md shadow-primary/20 leading-relaxed whitespace-pre-wrap break-words">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-1.5 max-w-[94%]">
      <div className={`${aiSpotlightCn(spotlight, 'bg-surface-container-low text-on-surface px-3.5 py-2 rounded-2xl rounded-tl-none leading-relaxed')} flex flex-col items-stretch min-w-0 gap-1`}>
        <MessageWithActionLinks text={msg.text} className="text-on-surface" />
        {msg.role === 'ai' &&
          msg.type === 'text' &&
          msg.ledgerBrowseSnapshot?.transactionIds?.length > 0 && (
            <button
              type="button"
              className="self-end shrink-0 text-[10px] font-semibold text-primary hover:text-primary hover:underline tabular-nums"
              onClick={() => {
                const s = msg.ledgerBrowseSnapshot
                if (!s?.transactionIds?.length) return
                restoreTrinityModeChat()
                setAiFilter({ label: s.label, ids: new Set(s.transactionIds) })
                queueMicrotask(() =>
                  document
                    .getElementById('data-vault-ledger')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
                )
              }}
            >
              ←원장 다시보기
            </button>
          )}
      </div>
      <TimeStamp time={msg.time} dateLabel="" />
    </div>
  )
}
