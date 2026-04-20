import { useState, useEffect, useRef, useCallback } from 'react'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'

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
  } = useVaultStore()
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const restoreTrinityMode = useUIStore((s) => s.restoreTrinityMode)
  const setAiFilter = useUIStore((s) => s.setAiFilter)
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLabel, setThinkingLabel] = useState('생각하는 중...')
  const bottomRef = useRef(null)
  // OpenAI 대화 히스토리 (세션 내 유지, 미영속)
  const conversationRef = useRef([])
  // 이전 메시지 수 추적 — 길이가 늘어날 때만 하단 스크롤
  const prevMsgCountRef = useRef(messages.length)

  const hoveredTx = hoveredTxId ? transactions.find((t) => t.id === hoveredTxId) : null

  useEffect(() => {
    const isNewMessage = messages.length > prevMsgCountRef.current
    prevMsgCountRef.current = messages.length
    if (isNewMessage || isThinking) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isThinking])

  // ─── 클라이언트 사이드 Tool 실행 ───────────────────────────────────────────
  const executeTool = useCallback(
    (toolName, args) => {
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
        else pool = pool.filter((t) => t.amount < 0)

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
        const { txId, category } = args
        const target = transactions.find((t) => t.id === String(txId))
        if (!target) return { success: false, error: `ID ${txId}인 거래를 찾을 수 없습니다.` }
        updateTransactionInline(String(txId), { category: String(category) })
        return { success: true, txId, previousCategory: target.category, newCategory: category }
      }

      return { error: `알 수 없는 도구: ${toolName}` }
    },
    [transactions, updateTransactionInline, setAiFilter],
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

          const res = await fetch('/api/chat-assistant', {
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

              const toolResult = executeTool(toolName, args)

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

  const handleSubmit = () => {
    const text = input.trim()
    if (!text || isThinking) return
    // AI가 완전한 오케스트레이터 — 모든 입력을 executeAiChat으로 처리
    // (기존 tier1 로컬 라우팅은 AI가 query_ledger로 대체)
    executeAiChat(text)
    setInput('')
  }

  return (
    <aside className="w-[360px] shrink-0 self-start lg:sticky lg:top-24 max-h-[calc(100vh-7rem)] bg-surface-container-lowest/80 backdrop-blur-xl rounded-xl shadow-2xl flex flex-col overflow-hidden hidden lg:flex">
      {/* Header */}
      <div className="p-4 border-b border-surface-container">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary-container flex items-center justify-center shadow-lg shadow-primary/20">
              <span className="material-symbols-outlined text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                smart_toy
              </span>
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 border-2 border-surface-container-lowest rounded-full ${isProcessing ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-on-surface">금고 AI</h2>
            <p className="text-[11px] text-on-surface-variant font-medium">
              {isProcessing ? '분석 중...' : '재무 비서 · 온라인'}
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-grow overflow-y-auto p-4 space-y-3 text-sm custom-scrollbar">
        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            msg={msg}
            transactions={transactions}
            knownAccounts={knownAccounts}
            onConfirm={confirmTransaction}
            onAccountConfirm={confirmTransactionAccount}
            onCompleteReview={completeTransactionReview}
            onAcknowledge={acknowledgeAlert}
            onLedgerResolve={resolveLedgerReview}
          />
        ))}

        {/* AI Thinking 버블 (로컬 상태, 미영속) */}
        {isThinking && (
          <div className="flex flex-col gap-1 max-w-[85%] animate-fade-in">
            <div className="bg-surface-container-low p-4 rounded-2xl rounded-tl-none">
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-primary/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-on-surface-variant text-xs font-medium">{thinkingLabel}</span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
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

      {/* Input */}
      <div className="p-4 pt-2.5">
        <div className="relative flex items-center bg-surface-container-low rounded-2xl p-2 px-4 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
            disabled={isThinking}
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 placeholder:text-outline-variant disabled:opacity-50"
            placeholder={isThinking ? thinkingLabel : '검색, 질문, 기록 등 무엇이든 지시하세요...'}
          />
          <button
            onClick={isChartMode ? restoreTrinityMode : openVizMode}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors active:scale-95 shrink-0 mr-2 ${
              isChartMode
                ? 'bg-primary text-white shadow-lg shadow-primary/20'
                : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
            }`}
            title="데이터 시각화"
          >
            <span className="material-symbols-outlined text-lg">radio_button_checked</span>
          </button>
          <button
            onClick={handleSubmit}
            className="w-10 h-10 bg-primary text-white rounded-xl flex items-center justify-center shadow-lg shadow-primary/30 hover:scale-105 transition-transform active:scale-95 shrink-0"
          >
            <span className="material-symbols-outlined text-xl">send</span>
          </button>
        </div>
      </div>
    </aside>
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
      <div className="flex flex-col gap-1 max-w-[85%] animate-fade-in">
        <div className="bg-surface-container-low p-4 rounded-2xl rounded-tl-none">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-primary/70 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-on-surface-variant text-xs">영수증을 분석하고 있습니다...</span>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'result') {
    return (
      <div className="flex flex-col gap-1 max-w-[85%] animate-fade-in">
        <div className="bg-primary/5 border border-primary/10 p-4 rounded-2xl rounded-tl-none space-y-2">
          <p className="text-on-surface leading-relaxed font-semibold">{msg.text}</p>
          <div className="pt-1 border-t border-primary/10 flex justify-between items-center text-[11px]">
            <span className="text-on-surface-variant italic">{msg.subtitle}</span>
            <span className="text-primary font-bold tabular-nums">소모: {msg.credit} C</span>
          </div>
        </div>
        <span className="text-[10px] text-outline ml-1">{msg.time}</span>
      </div>
    )
  }

  if (msg.type === 'confirm') {
    const isResolved = msg.resolved || (tx && tx.status === 'CONFIRMED')
    const options = Array.isArray(msg.options) ? msg.options : []
    return (
      <div className="flex flex-col gap-1 max-w-[85%] animate-fade-in">
        <div className="bg-surface-container-low text-on-surface p-4 rounded-2xl rounded-tl-none leading-relaxed">
          {msg.text}
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
        <span className="text-[10px] text-outline ml-1">{msg.time}</span>
      </div>
    )
  }

  if (msg.type === 'account_confirm') {
    const isResolved = msg.resolved || (tx?.status === 'CONFIRMED' && Boolean(tx?.account))
    const categoryOptions = Array.isArray(msg.options) ? msg.options : []
    const canSubmit = Boolean(selectedCategory.trim() && accountInput.trim() && msg.txId)
    return (
      <div className="flex flex-col gap-1 max-w-[88%] animate-fade-in">
        <div className="bg-surface-container-low text-on-surface p-3 rounded-2xl rounded-tl-none leading-relaxed">
          {msg.text}
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
        <span className="text-[10px] text-outline ml-1">{msg.time}</span>
      </div>
    )
  }

  if (msg.type === 'alert') {
    return (
      <div className="flex flex-col gap-1 max-w-[90%] animate-fade-in">
        <div
          className={`p-4 rounded-2xl rounded-tl-none leading-relaxed border ${
            msg.resolved
              ? 'bg-surface-container-low border-surface-container'
              : 'bg-gradient-to-r from-[#FFD700] via-[#FFEA70] to-[#F1C40F] border-[#FFD700]/80 alert-gold-glow'
          }`}
        >
          <p className={`${msg.resolved ? 'text-on-surface' : 'text-[#121212]'} font-semibold`}>{msg.text}</p>
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
        <span className="text-[10px] text-outline ml-1">{msg.time}</span>
      </div>
    )
  }

  if (msg.type === 'ledger_review') {
    return (
      <div className="flex flex-col gap-1 max-w-[90%] animate-fade-in">
        <div className="bg-surface-container-low text-on-surface p-4 rounded-2xl rounded-tl-none leading-relaxed border border-primary/15">
          <p className="font-semibold">{msg.text}</p>
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
        <span className="text-[10px] text-outline ml-1">{msg.time}</span>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="flex flex-col gap-1 items-end ml-auto max-w-[85%] animate-fade-in">
        <div className="bg-primary text-white p-4 rounded-2xl rounded-tr-none shadow-md shadow-primary/20 leading-relaxed">
          {msg.text}
        </div>
        <span className="text-[10px] text-outline mr-1">{msg.time}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 max-w-[85%] animate-fade-in">
      <div className="bg-surface-container-low text-on-surface p-4 rounded-2xl rounded-tl-none leading-relaxed">
        {msg.text}
      </div>
      <span className="text-[10px] text-outline ml-1">{msg.time}</span>
    </div>
  )
}
