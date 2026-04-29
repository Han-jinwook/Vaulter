import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'

const weekdaysShort = ['일', '월', '화', '수', '목', '금', '토']

function fmtAmount(n) {
  const abs = Math.abs(n).toLocaleString('ko-KR')
  return n > 0 ? `+₩${abs}` : `-₩${abs}`
}

function fmtDateGroup(rawDate) {
  const [year, month, day] = String(rawDate).split('.').map(Number)
  const d = new Date(year, month - 1, day)
  return `${String(year).slice(2)}년 ${month}월 ${day}일(${weekdaysShort[d.getDay()]})`
}

function dateToTs(rawDate) {
  const [y, m, d] = String(rawDate).split('.').map(Number)
  if (!y || !m || !d) return 0
  return new Date(y, m - 1, d).getTime()
}

function buildSourceLabel(tx) {
  const source = String(tx?.source || '').trim()
  const rawDetail = String(tx?.location || '').trim()
  const detailLower = rawDetail.toLowerCase()

  if (source === 'manual') return '입력'

  if (source === 'upload') {
    return rawDetail ? `문서 · ${rawDetail}` : '문서'
  }

  if (source === 'gmail') {
    if (!rawDetail || detailLower.includes('gmail')) return 'Gmail'
    return `Gmail · ${rawDetail}`
  }

  if (source === 'webhook') {
    return rawDetail ? `연동 · ${rawDetail}` : '연동'
  }

  return rawDetail || '기타'
}

export default function TransactionTable() {
  const {
    transactions,
    reviewPinnedTxIds,
    updateTransactionInline,
    hoveredTxId,
    setHoveredTx,
    ledgerContextTitle,
    activeLedgerFilter,
    setLedgerContextByFilter,
  } = useVaultStore()

  const confirmedAccountSuggestions = useMemo(() => {
    const names = new Set()
    for (const tx of transactions) {
      if (tx.status !== 'CONFIRMED') continue
      const acc = String(tx.account ?? '').trim()
      if (acc) names.add(acc)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [transactions])
  const aiFilter = useUIStore((s) => s.aiFilter)
  const clearAiFilter = useUIStore((s) => s.clearAiFilter)
  const requestLedgerChatScrollToTx = useUIStore((s) => s.requestLedgerChatScrollToTx)
  const [editingCell, setEditingCell] = useState(null)
  const [draftValue, setDraftValue] = useState('')

  const reviewCount = transactions.filter((tx) => tx.status === 'PENDING').length

  const filteredTransactions = useMemo(() => {
    // AI 필터가 활성화된 경우 ID 기반으로 우선 적용
    if (aiFilter?.ids) {
      return transactions.filter((tx) => aiFilter.ids.has(tx.id))
    }
    if (activeLedgerFilter === 'review') {
      return transactions.filter((tx) => tx.status === 'PENDING' || reviewPinnedTxIds.includes(tx.id))
    }
    if (activeLedgerFilter === 'income') return transactions.filter((tx) => tx.amount > 0)
    if (activeLedgerFilter === 'expense') return transactions.filter((tx) => tx.amount < 0)
    return transactions
  }, [transactions, activeLedgerFilter, reviewPinnedTxIds, aiFilter])

  const aiMatchCount = useMemo(() => {
    if (!aiFilter?.ids) return 0
    return transactions.reduce((count, tx) => (aiFilter.ids.has(tx.id) ? count + 1 : count), 0)
  }, [transactions, aiFilter])

  const sortedTransactions = useMemo(() => {
    return [...filteredTransactions].sort((a, b) => {
      const dateDiff = dateToTs(b.date) - dateToTs(a.date)
      if (dateDiff !== 0) return dateDiff
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    })
  }, [filteredTransactions])

  const groupedTransactions = useMemo(() => {
    return sortedTransactions.reduce((groups, tx) => {
      const last = groups[groups.length - 1]
      if (!last || last.date !== tx.date) {
        groups.push({ date: tx.date, items: [tx] })
      } else {
        last.items.push(tx)
      }
      return groups
    }, [])
  }, [sortedTransactions])

  const beginEdit = (txId, field, value) => {
    setEditingCell({ txId, field })
    setDraftValue(String(value ?? ''))
  }

  const commitEdit = () => {
    if (!editingCell) return
    const { txId, field } = editingCell
    const nextRaw = draftValue.trim()
    if (field === 'amount') {
      const numeric = Number(nextRaw.replace(/[^\d.-]/g, ''))
      if (!Number.isFinite(numeric) || numeric <= 0) {
        setEditingCell(null)
        return
      }
      const tx = transactions.find((item) => item.id === txId)
      if (tx) {
        const signed = tx.amount > 0 ? Math.abs(numeric) : -Math.abs(numeric)
        void updateTransactionInline(txId, { amount: signed })
      }
    } else {
      void updateTransactionInline(txId, { [field]: nextRaw })
    }
    setEditingCell(null)
  }

  const cancelEdit = () => setEditingCell(null)

  const isEditing = (txId, field) => editingCell?.txId === txId && editingCell?.field === field

  return (
    <div
      id="data-vault-ledger"
      className="bg-surface-container-lowest rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col overflow-hidden min-h-[360px] max-h-[min(70dvh,calc(100dvh-20rem))]"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface-container-lowest/95 backdrop-blur px-5 py-4 border-b border-surface-container">
        {/* AI 필터 배너 */}
        {aiFilter && (
          <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 bg-primary/[0.07] border border-primary/20 rounded-xl animate-fade-in">
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 text-sm text-primary font-medium min-w-0">
                <span className="material-symbols-outlined text-base shrink-0">smart_toy</span>
                <span className="truncate">AI 검색 결과: {aiFilter.label}</span>
                <span className="text-[11px] font-bold shrink-0">({aiMatchCount}건)</span>
              </div>
              <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                현재는 검색 결과만 표시 중입니다. 전체 내역은 `전체 보기`로 복귀할 수 있어요.
              </p>
            </div>
            <button
              onClick={clearAiFilter}
              className="shrink-0 flex items-center gap-1 text-[11px] text-primary font-semibold px-2.5 py-1.5 rounded-lg bg-primary/[0.08] hover:bg-primary/[0.16] transition-colors"
            >
              전체 보기
            </button>
          </div>
        )}

        <div className="flex flex-wrap justify-between items-center gap-2">
          <div>
            <h3 key={ledgerContextTitle} className="font-bold text-base animate-fade-in">
              {ledgerContextTitle}
            </h3>
            <p className="mt-1 text-[11px] text-on-surface-variant">
              원장 목록은 카드 안쪽에서만 스크롤됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="전체"
              active={activeLedgerFilter === 'all'}
              onClick={() => setLedgerContextByFilter('all')}
            />
            <FilterChip
              label={`🚨 검토 필요 (${reviewCount})`}
              active={activeLedgerFilter === 'review'}
              onClick={() => setLedgerContextByFilter('review')}
            />
            <FilterChip
              label="수입"
              active={activeLedgerFilter === 'income'}
              onClick={() => setLedgerContextByFilter('income')}
            />
            <FilterChip
              label="지출"
              active={activeLedgerFilter === 'expense'}
              onClick={() => setLedgerContextByFilter('expense')}
            />
          </div>
        </div>
      </div>

      <div className="ledger-scrollbar-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {groupedTransactions.map((group) => (
          <div key={group.date} className="pt-3">
            <div className="text-gray-500 text-xs font-medium pb-1.5">{fmtDateGroup(group.date)}</div>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
              {group.items.map((tx) => {
                const isHovered = hoveredTxId === tx.id
                return (
                  <div
                    key={tx.id}
                    onMouseEnter={() => setHoveredTx(tx.id)}
                    onMouseLeave={() => setHoveredTx(null)}
                    className={`px-3 md:px-4 py-3 bg-transparent transition-colors ${
                      isHovered ? 'bg-primary/[0.05]' : 'hover:bg-surface-container-low/50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: tx.iconBg }}
                      >
                        <span className="material-symbols-outlined text-base" style={{ color: tx.iconColor }}>
                          {tx.icon}
                        </span>
                      </div>

                      <div className="min-w-[150px]">
                        {isEditing(tx.id, 'name') ? (
                          <InlineInput
                            value={draftValue}
                            setValue={setDraftValue}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                          />
                        ) : (
                          <p
                            onDoubleClick={() => beginEdit(tx.id, 'name', tx.name)}
                            className="font-semibold text-sm text-gray-900 truncate cursor-text"
                          >
                            {tx.name}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-500 mt-0.5">{buildSourceLabel(tx)}</p>
                      </div>

                      <div className="flex-1 min-w-[120px] px-1.5">
                        {isEditing(tx.id, 'userMemo') ? (
                          <InlineInput
                            value={draftValue}
                            setValue={setDraftValue}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                          />
                        ) : (
                          <p
                            onDoubleClick={() => beginEdit(tx.id, 'userMemo', tx.userMemo || '')}
                            className="text-[11px] text-gray-700 cursor-text truncate"
                          >
                            {tx.userMemo?.trim() ? tx.userMemo : '(메모 없음)'}
                          </p>
                        )}
                      </div>

                      <div className="ml-auto flex items-center gap-1.5 pr-1">
                        {isEditing(tx.id, 'account') ? (
                          <AccountDropdown
                            value={draftValue}
                            setValue={setDraftValue}
                            suggestedAccounts={confirmedAccountSuggestions}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                          />
                        ) : (
                          <span
                            onDoubleClick={() => beginEdit(tx.id, 'account', tx.account || '')}
                            className="px-2 py-1 bg-surface-container-low text-on-surface-variant text-[11px] rounded-full font-semibold cursor-text"
                          >
                            {tx.account || '계정 미지정'}
                          </span>
                        )}
                        {isEditing(tx.id, 'category') ? (
                          <InlineInput
                            value={draftValue}
                            setValue={setDraftValue}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                          />
                        ) : tx.category ? (
                          <span
                            onDoubleClick={() => beginEdit(tx.id, 'category', tx.category)}
                            className="px-2.5 py-1 bg-primary/10 text-primary text-xs rounded-full font-extrabold cursor-text"
                          >
                            {tx.category}
                          </span>
                        ) : (
                          <span
                            onDoubleClick={() => beginEdit(tx.id, 'category', '')}
                            className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] rounded-full font-bold cursor-text"
                          >
                            분류 대기
                          </span>
                        )}
                        {tx.status === 'PENDING' ? (
                          <button
                            type="button"
                            title="관련 채팅 보기"
                            onClick={(e) => {
                              e.stopPropagation()
                              requestLedgerChatScrollToTx(tx.id)
                            }}
                            className="px-2 py-1 bg-red-100 text-red-700 text-[10px] rounded-full font-bold hover:bg-red-200/90 transition-colors"
                          >
                            🚨 검토 필요
                          </button>
                        ) : null}
                      </div>

                      {isEditing(tx.id, 'amount') ? (
                        <div className="w-28">
                          <InlineInput
                            value={draftValue}
                            setValue={setDraftValue}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                          />
                        </div>
                      ) : (
                        <div
                          onDoubleClick={() => beginEdit(tx.id, 'amount', Math.abs(tx.amount))}
                          className={`text-right text-base font-bold tabular-nums cursor-text ${tx.amount > 0 ? 'text-primary' : 'text-gray-900'}`}
                        >
                          {fmtAmount(tx.amount)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
        active
          ? 'bg-primary text-white'
          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
      }`}
    >
      {label}
    </button>
  )
}

function InlineInput({ value, setValue, onCommit, onCancel }) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onCancel()
      }}
      className="w-full px-2 py-1 text-xs border border-primary/30 rounded-md outline-none focus:ring-2 focus:ring-primary/20"
    />
  )
}

function AccountDropdown({ value, setValue, suggestedAccounts = [], onCommit, onCancel }) {
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const [dropRect, setDropRect] = useState(null)

  useLayoutEffect(() => {
    const update = () => {
      const el = inputRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width < 1 && r.height < 1) {
        requestAnimationFrame(update)
        return
      }
      setDropRect({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(r.width, 136),
      })
    }
    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [value])

  useEffect(() => {
    const handler = (e) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (inputRef.current?.contains(t) || panelRef.current?.contains(t)) return
      onCommit()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onCommit])

  const filtered = suggestedAccounts.filter((a) =>
    !value || a.toLowerCase().includes(value.toLowerCase()),
  )

  return (
    <div data-account-dropdown="" className="relative">
      <input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="계정 입력..."
        className="w-28 px-2 py-1 text-xs border border-primary/40 rounded-md outline-none focus:ring-2 focus:ring-primary/20 bg-white"
      />
      {filtered.length > 0 && dropRect && createPortal(
        <div
          ref={panelRef}
          data-account-dropdown-panel=""
          data-account-dropdown=""
          style={{
            position: 'fixed',
            top: dropRect.top,
            left: dropRect.left,
            width: dropRect.width,
            zIndex: 9999,
          }}
          className="bg-white border border-surface-container rounded-xl shadow-xl py-1 max-h-52 overflow-y-auto box-border"
        >
          {filtered.map((acct) => (
            <button
              key={acct}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                setValue(acct)
                setTimeout(onCommit, 0)
              }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-primary/10 transition-colors ${
                value === acct ? 'text-primary font-bold bg-primary/5' : 'text-on-surface'
              }`}
            >
              {acct}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
