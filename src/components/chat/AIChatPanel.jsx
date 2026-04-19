import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'
import { handleTier1Intent } from '../../ai/intentRouter'

export default function AIChatPanel() {
  const {
    messages,
    hoveredTxId,
    transactions,
    confirmTransaction,
    confirmTransactionAccount,
    completeTransactionReview,
    askAboutTransaction,
    isProcessing,
    acknowledgeAlert,
    resolveLedgerReview,
    setLedgerContextByFilter,
    setLedgerAiReviewContext,
  } = useVaultStore()
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const restoreTrinityMode = useUIStore((s) => s.restoreTrinityMode)
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const navigate = useNavigate()

  const hoveredTx = hoveredTxId ? transactions.find((t) => t.id === hoveredTxId) : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = () => {
    const text = input.trim()
    if (!text) return

    handleTier1Intent(text, {
      onRouteLedger: () => {
        setLedgerContextByFilter('all')
        navigate('/')
        window.setTimeout(() => {
          const target = document.getElementById('data-vault-ledger')
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      },
      onAnalyzeUnclassified: () => {
        const pendingRows = transactions.filter((tx) => tx.status === 'PENDING')
        setLedgerAiReviewContext()
        navigate('/')
        window.setTimeout(() => {
          const target = document.getElementById('data-vault-ledger')
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
        console.log(`[Intent] PENDING ${pendingRows.length}건 집중 검토 시작`)
        pendingRows.forEach((tx) => askAboutTransaction(tx.id))
      },
      onGeneralChat: () => {},
    })

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
            onConfirm={confirmTransaction}
            onAccountConfirm={confirmTransactionAccount}
            onCompleteReview={completeTransactionReview}
            onAcknowledge={acknowledgeAlert}
            onLedgerResolve={resolveLedgerReview}
          />
        ))}
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
            className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 placeholder:text-outline-variant"
            placeholder="검색, 질문, 기록 등 무엇이든 지시하세요..."
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
    const accountOptions = Array.isArray(msg.accountOptions) ? msg.accountOptions : []
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
            {accountOptions.length ? (
              <div className="flex flex-wrap gap-2 mt-1 ml-1">
                {accountOptions.map((opt) => (
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
