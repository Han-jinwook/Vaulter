import { useMemo, useState } from 'react'
import { useVaultStore } from '../../stores/vaultStore'

const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

function fmtAmount(n) {
  const abs = Math.abs(n).toLocaleString('ko-KR')
  return n > 0 ? `+₩${abs}` : `-₩${abs}`
}

function fmtDateGroup(rawDate) {
  const [year, month, day] = String(rawDate).split('.').map(Number)
  const d = new Date(year, month - 1, day)
  return `${String(year).slice(2)}년 ${month}월 ${day}일 ${weekdays[d.getDay()]}`
}

function dateToTs(rawDate) {
  const [y, m, d] = String(rawDate).split('.').map(Number)
  if (!y || !m || !d) return 0
  return new Date(y, m - 1, d).getTime()
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
  const [editingCell, setEditingCell] = useState(null)
  const [draftValue, setDraftValue] = useState('')

  const reviewCount = transactions.filter((tx) => tx.status === 'PENDING').length

  const filteredTransactions = useMemo(() => {
    if (activeLedgerFilter === 'review') {
      return transactions.filter((tx) => tx.status === 'PENDING' || reviewPinnedTxIds.includes(tx.id))
    }
    if (activeLedgerFilter === 'income') return transactions.filter((tx) => tx.amount > 0)
    if (activeLedgerFilter === 'expense') return transactions.filter((tx) => tx.amount < 0)
    return transactions
  }, [transactions, activeLedgerFilter, reviewPinnedTxIds])

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
        updateTransactionInline(txId, { amount: signed })
      }
    } else {
      updateTransactionInline(txId, { [field]: nextRaw })
    }
    setEditingCell(null)
  }

  const cancelEdit = () => setEditingCell(null)

  const isEditing = (txId, field) => editingCell?.txId === txId && editingCell?.field === field

  return (
    <div
      id="data-vault-ledger"
      className="bg-surface-container-lowest rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col min-h-[420px]"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface-container-lowest/95 backdrop-blur px-5 py-4 border-b border-surface-container">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div>
            <h3 key={ledgerContextTitle} className="font-bold text-base animate-fade-in">
              {ledgerContextTitle}
            </h3>
            <p className="mt-1 text-[11px] text-on-surface-variant">
              내부 스크롤 대신 페이지를 그대로 내려 전체 원장을 이어서 볼 수 있어요.
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

      <div className="px-4 pb-4">
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
                        {isEditing(tx.id, 'location') ? (
                          <InlineInput
                            value={draftValue}
                            setValue={setDraftValue}
                            onCommit={commitEdit}
                            onCancel={cancelEdit}
                          />
                        ) : (
                          tx.location && (
                            <p
                              onDoubleClick={() => beginEdit(tx.id, 'location', tx.location)}
                              className="text-[10px] text-gray-500 mt-0.5 cursor-text"
                            >
                              {tx.location}
                            </p>
                          )
                        )}
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
                            {tx.userMemo || '메모를 더블클릭해 입력'}
                          </p>
                        )}
                      </div>

                      <div className="ml-auto flex items-center gap-1.5 pr-1">
                        {isEditing(tx.id, 'account') ? (
                          <InlineInput
                            value={draftValue}
                            setValue={setDraftValue}
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
                        {tx.status === 'PENDING' && (
                          <span className="px-2 py-1 bg-red-100 text-red-700 text-[10px] rounded-full font-bold">
                            🚨 검토 필요
                          </span>
                        )}
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
