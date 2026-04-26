import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import IsolatedChatComposer from './IsolatedChatComposer'
import { MessageWithActionLinks } from './MessageWithActionLinks'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'
import { isConsumptiveLedgerExpense } from '../../lib/ledgerCategoryPolicy'
import { resolveApiUrl } from '../../lib/resolveApiUrl'
import { CHAT_PANEL_ASIDE_LAYOUT } from './chatPanelAsideLayout'

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

// 로컬 원장 쿼리 (client-side tool 실행)
function runQueryLedger(transactions, args) {
  const { startDate, endDate, category, excludeCategories, account, merchant, type, sortBy = 'date_desc', minAmount, maxAmount, limit = 20 } = args
  let results = [...transactions]

  if (startDate) results = results.filter((tx) => normalizeDate(tx.date) >= startDate)
  if (endDate)   results = results.filter((tx) => normalizeDate(tx.date) <= endDate)
  if (type === 'expense') results = results.filter((tx) => tx.amount < 0)
  if (type === 'income')  results = results.filter((tx) => tx.amount > 0)
  if (Array.isArray(excludeCategories) && excludeCategories.length > 0) {
    const excl = excludeCategories.map((c) => c.toLowerCase())
    results = results.filter((tx) => !excl.some((e) => tx.category?.toLowerCase().includes(e)))
  }
  if (category) {
    const q = category.toLowerCase()
    results = results.filter((tx) => tx.category?.toLowerCase().includes(q))
  }
  if (account) {
    const q = account.toLowerCase()
    results = results.filter((tx) => tx.account?.toLowerCase().includes(q))
  }
  if (merchant) {
    const q = merchant.toLowerCase()
    results = results.filter(
      (tx) => tx.name?.toLowerCase().includes(q) || tx.merchant?.toLowerCase().includes(q),
    )
  }
  if (minAmount != null) results = results.filter((tx) => Math.abs(tx.amount) >= minAmount)
  if (maxAmount != null) results = results.filter((tx) => Math.abs(tx.amount) <= maxAmount)

  const sorted = results.sort((a, b) => {
    if (sortBy === 'amount_desc') return Math.abs(b.amount) - Math.abs(a.amount)
    if (sortBy === 'amount_asc')  return Math.abs(a.amount) - Math.abs(b.amount)
    if (sortBy === 'date_asc')    return normalizeDate(a.date).localeCompare(normalizeDate(b.date))
    return normalizeDate(b.date).localeCompare(normalizeDate(a.date)) // date_desc
  })

  const mapped = sorted
    .slice(0, Math.min(limit, 100))
    .map((tx) => ({
      id: tx.id,
      date: normalizeDate(tx.date),
      name: tx.name || tx.merchant || '(이름 없음)',
      amount: tx.amount,
      category: tx.category || '미분류',
      account: tx.account || '',
      status: tx.status,
    }))

  // GPT가 필터가 너무 좁은지 판단할 수 있도록 DB 전체 현황도 함께 반환
  const allDates = transactions.map((t) => normalizeDate(t.date)).filter(Boolean).sort()
  return {
    count: mapped.length,
    transactions: mapped,
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
    hoveredTxId,
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
    addLedgerEntry,
  } = useVaultStore()
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const restoreTrinityMode = useUIStore((s) => s.restoreTrinityMode)
  const setAiFilter = useUIStore((s) => s.setAiFilter)
  const setVizFilter = useUIStore((s) => s.setVizFilter)
  const clearVizFilter = useUIStore((s) => s.clearVizFilter)
  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLabel, setThinkingLabel] = useState('생각하는 중...')
  // 채팅 메시지 스크롤 컨테이너 ref
  const msgContainerRef = useRef(null)
  // OpenAI 대화 히스토리 (세션 내 유지, 미영속)
  const conversationRef = useRef([])
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

  const hoveredTx = hoveredTxId ? transactions.find((t) => t.id === hoveredTxId) : null

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
        const result = runQueryLedger(transactions, args)
        const sum = Math.abs(result.transactions.reduce((s, t) => s + t.amount, 0))

        // 결과가 있으면 원장 UI를 즉시 필터링
        if (result.count > 0) {
          const ids = new Set(result.transactions.map((t) => t.id))
          const parts = [
            args.startDate && args.endDate ? `${args.startDate} ~ ${args.endDate}` : null,
            args.category || null,
            args.merchant || null,
          ].filter(Boolean)
          setAiFilter({ label: parts.join(' · ') || 'AI 검색 결과', ids })
        }

        return {
          ...result,
          summary: result.count === 0
            ? `해당 조건의 내역이 없습니다. (DB에는 총 ${result._db.totalTransactions}건, 기간: ${result._db.dateRange}, 카테고리 목록: ${result._db.categories.join(', ')})`
            : `총 ${result.count}건, 합계 ₩${sum.toLocaleString()}`,
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
        return {
          success: true,
          ...out,
          need_account_clarify: needAccount,
          note: needAccount
            ? '【필수】원장이 반영됨(계정 미지정). 이 응답 턴의 **끝**에, 현금·카드(또는 이체/통장) 중 **어떤 돈**으로 쓰셨는지 **꼭 한 문장**으로 질문할 것(인사만 하지 말 것).'
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
    [transactions, updateTransactionInline, addLedgerEntry, setAiFilter, openVizMode, setVizFilter, clearVizFilter],
  )

  // ─── AI 채팅 멀티턴 루프 ───────────────────────────────────────────────────
  const executeAiChat = useCallback(
    async (userText) => {
      // 1) 유저 메시지 UI 추가 + 히스토리에 기록
      addChatMessage({ role: 'user', type: 'text', text: userText })
      conversationRef.current.push({ role: 'user', content: userText })

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
              else if (toolName === 'add_ledger_entry') setThinkingLabel('가계부에 기록하는 중...')
              else if (toolName === 'render_visualization') setThinkingLabel('시각화를 여는 중...')

              const toolResult = await executeTool(toolName, args)

              conversationRef.current.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolResult),
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
              if (ids.size > 0) setAiFilter({ label: winnerCategory, ids })
            }
            // 태그를 제거한 깔끔한 텍스트만 채팅에 표시
            const cleanText = data.text.replace(/\s*\[WINNER_CATEGORY:[^\]]+\]/g, '').trim()
            addChatMessage({ role: 'ai', type: 'text', text: cleanText })
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
            <span className="text-[10px] text-outline/80 font-medium shrink-0">{headerDate}</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={msgContainerRef}
        onScroll={handleMsgScroll}
        className="flex-grow overflow-y-auto px-3 py-2 space-y-1 text-sm custom-scrollbar"
      >
        {/* 위쪽 이전 대화 로드 표시 */}
        {hasOlderMessages && (
          <div className="text-center py-1">
            <span className="text-[10px] text-outline/50">위로 스크롤하면 이전 대화를 불러옵니다</span>
          </div>
        )}
        {visibleMessages.map((msg) => {
          const animate = !initialMsgIdsRef.current.has(msg.id)
          const msgDate = formatDateLabel(msg.createdAt || new Date().toISOString())
          return (
            <div
              key={msg.id}
              data-msg-date={msgDate}
              className={animate ? 'animate-fade-in' : ''}
            >
              <ChatBubble
                msg={msg}
                transactions={transactions}
                knownAccounts={knownAccounts}
                onConfirm={confirmTransaction}
                onAccountConfirm={confirmTransactionAccount}
                onCompleteReview={completeTransactionReview}
                onAcknowledge={acknowledgeAlert}
                onLedgerResolve={resolveLedgerReview}
              />
            </div>
          )
        })}

        {/* AI Thinking 버블 */}
        {isThinking && (
          <div className="flex items-end gap-1.5 max-w-[94%] animate-fade-in">
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

      {/* Hover Context Chip */}
      {hoveredTx && (
        <div className="px-4 py-2 animate-fade-in">
          <div className="bg-primary/5 border border-primary/15 rounded-xl px-4 py-2.5 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-base">visibility</span>
            <span className="text-xs">
              <span className="text-primary font-bold">{hoveredTx.name}</span>
              <span className="text-on-surface-variant ml-1">내역 선택됨</span>
            </span>
            <span className="ml-auto text-xs font-bold tabular-nums text-on-surface-variant">
              {hoveredTx.amount > 0 ? '+' : ''}₩{Math.abs(hoveredTx.amount).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      <IsolatedChatComposer
        variant="keeper"
        disabled={isThinking}
        thinkingLabel={thinkingLabel}
        idlePlaceholder="금고 AI비서에게 무엇이든 지시하세요."
        onSend={stableOnSend}
      />
    </aside>
  )
}

// ── 날짜 레이블 포맷 (createdAt ISO → "4월 13일 (월)") ──────────────────────
function formatDateLabel(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

// ── 버블 옆 타임스탬프 ────────────────────────────────────────────────────────
function TimeStamp({ time }) {
  return (
    <div className="shrink-0 self-end pb-0.5">
      <span className="text-[10px] text-outline leading-tight whitespace-nowrap">{time}</span>
    </div>
  )
}

function ChatBubble({
  msg,
  transactions,
  knownAccounts,
  onConfirm,
  onAccountConfirm,
  onCompleteReview,
  onAcknowledge,
  onLedgerResolve,
}) {
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

  useEffect(() => {
    if (msg.type !== 'account_confirm') return
    if (!selectedCategory.trim() && tx?.category) {
      setSelectedCategory(tx.category)
    }
    if (!accountInput.trim() && tx?.account) {
      setAccountInput(tx.account)
    }
  }, [accountInput, msg.type, selectedCategory, tx?.account, tx?.category])

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
        <div className="bg-surface-container-low px-3 py-2 rounded-2xl rounded-tl-none">
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
        <div className="bg-primary/5 border border-primary/10 px-3.5 py-2.5 rounded-2xl rounded-tl-none space-y-1.5">
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
        <div className="bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed">
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
    const canSubmit = Boolean(selectedCategory.trim() && accountInput.trim() && msg.txId)
    return (
      <div className="flex flex-col gap-1 max-w-[94%]">
        <div className="flex items-end gap-1.5">
        <div className="bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed">
          {msg.text}
        </div>
        <TimeStamp time={msg.time} dateLabel="" />
        </div>
        {!isResolved ? (
          <>
            <div className="ml-1 mt-1 text-[11px] font-semibold text-on-surface-variant">항목</div>
            <div className="flex flex-wrap gap-2 mt-1 ml-1">
              {categoryOptions.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => {
                    if (opt.category === '__CUSTOM__') {
                      setIsCustomInputOpen(true)
                      return
                    }
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
                      if (!next || !msg.txId) return
                      setSelectedCategory(next)
                      setIsCustomInputOpen(false)
                      setCustomCategory('')
                    }
                    if (e.key === 'Escape') setIsCustomInputOpen(false)
                  }}
                  placeholder="계정명 입력 (예: 통장1)"
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
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
            <div className="ml-1 mt-3 text-[11px] font-semibold text-on-surface-variant">계정</div>
            {liveAccountOptions.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-1 ml-1">
                {liveAccountOptions.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setAccountInput(opt.category)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all duration-200 active:scale-95 ${
                      accountInput === opt.category
                        ? 'bg-primary text-white border-primary'
                        : 'bg-primary/5 text-primary border-primary/15 hover:bg-primary hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-2 ml-1 flex items-center gap-2">
              <input
                value={accountInput}
                onChange={(e) => setAccountInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) {
                    onCompleteReview(String(msg.txId), selectedCategory.trim(), accountInput.trim())
                  }
                }}
                placeholder="계정명 직접입력 (예: 통장1, 현대카드)"
                className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                onClick={() => onCompleteReview(String(msg.txId), selectedCategory.trim(), accountInput.trim())}
                disabled={!canSubmit}
                className="px-3 py-1.5 bg-primary text-white text-xs rounded-lg font-bold disabled:opacity-50"
              >
                확인
              </button>
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
          className={`px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed border ${
            msg.resolved
              ? 'bg-surface-container-low border-surface-container'
              : 'bg-gradient-to-r from-[#FFD700] via-[#FFEA70] to-[#F1C40F] border-[#FFD700]/80 alert-gold-glow'
          }`}
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
        <div className="bg-surface-container-low text-on-surface px-3.5 py-2.5 rounded-2xl rounded-tl-none leading-relaxed border border-primary/15">
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

  if (msg.role === 'user') {
    return (
      <div className="flex items-end justify-end gap-1.5 ml-auto max-w-[94%]">
        <TimeStamp time={msg.time} />
        <div className="bg-primary text-white px-3.5 py-2 rounded-2xl rounded-tr-none shadow-md shadow-primary/20 leading-relaxed">
          {msg.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-1.5 max-w-[94%]">
      <div className="bg-surface-container-low text-on-surface px-3.5 py-2 rounded-2xl rounded-tl-none leading-relaxed">
        <MessageWithActionLinks text={msg.text} className="text-on-surface" />
      </div>
      <TimeStamp time={msg.time} dateLabel="" />
    </div>
  )
}
