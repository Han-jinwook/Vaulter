import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { LEDGER_CATEGORY_FILTER_UNASSIGNED, useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'
import { normalizeLedgerAccountLabel } from '../../lib/ledgerAccountNormalize'

const weekdaysShort = ['일', '월', '화', '수', '목', '금', '토']

function fmtAmount(n) {
  const abs = Math.abs(n).toLocaleString('ko-KR')
  return n > 0 ? `+₩${abs}` : `-₩${abs}`
}

function fmtDateCompact(rawDate) {
  const [year, month, day] = String(rawDate).split('.').map(Number)
  const d = new Date(year, month - 1, day)
  return `${String(year).slice(2)}/${month}/${day}(${weekdaysShort[d.getDay()]})`
}

function dateToTs(rawDate) {
  const [y, m, d] = String(rawDate).split('.').map(Number)
  if (!y || !m || !d) return 0
  return new Date(y, m - 1, d).getTime()
}

/** 원장 날짜 `YYYY.MM.DD` → 연·월 */
function parseTxYearMonth(rawDate) {
  const m = String(rawDate).match(/^(\d{4})\.(\d{2})\./)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]) }
}

function txMatchesLedgerPeriod(rawDate, preset) {
  if (preset.kind === 'all') return true
  const cal = parseTxYearMonth(rawDate)
  if (!cal) return false
  if (preset.kind === 'year') return cal.year === preset.year
  return cal.year === preset.year && cal.month === preset.month
}

function ledgerPresetToSelectValue(preset) {
  if (preset.kind === 'all') return 'all'
  if (preset.kind === 'year') return `year:${preset.year}`
  return `month:${preset.year}-${String(preset.month).padStart(2, '0')}`
}

function selectValueToLedgerPreset(value) {
  if (!value || value === 'all') return { kind: 'all' }
  if (value.startsWith('year:')) {
    const y = Number(value.slice(5))
    return Number.isFinite(y) ? { kind: 'year', year: y } : { kind: 'all' }
  }
  if (value.startsWith('month:')) {
    const match = value.match(/^month:(\d{4})-(\d{2})$/)
    if (match) {
      const year = Number(match[1])
      const month = Number(match[2])
      if (Number.isFinite(year) && Number.isFinite(month))
        return { kind: 'month', year, month: Math.min(12, Math.max(1, month)) }
    }
  }
  return { kind: 'all' }
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
    ledgerPeriodPreset,
    ledgerAccountFilter,
    ledgerCategoryFilter,
    setLedgerPeriodPreset,
    setLedgerAccountFilter,
    setLedgerCategoryFilter,
    deleteLine,
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
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  /** 정규화 키당 대표 라벨 하나 — 동일 계정의 유니코드 변형이 필터에서 따로 노출·미매칭되지 않게 함 */
  const ledgerAccountCanonByNorm = useMemo(() => {
    const m = new Map()
    for (const tx of transactions) {
      const raw = String(tx.account ?? '').trim()
      if (!raw) continue
      const norm = normalizeLedgerAccountLabel(raw)
      if (!m.has(norm)) m.set(norm, raw)
    }
    return m
  }, [transactions])

  const ledgerAccountChoices = useMemo(
    () => [...ledgerAccountCanonByNorm.values()].sort((a, b) => a.localeCompare(b, 'ko')),
    [ledgerAccountCanonByNorm],
  )

  const accountSelectValue =
    ledgerAccountFilter?.trim()
      ? ledgerAccountCanonByNorm.get(normalizeLedgerAccountLabel(ledgerAccountFilter)) ??
        ledgerAccountFilter.trim()
      : ''

  /** 거래에서 사라진 계정으로 필터가 고정돼 있으면 해제 */
  useEffect(() => {
    const af = ledgerAccountFilter != null ? String(ledgerAccountFilter).trim() : ''
    if (!af) return
    const afNorm = normalizeLedgerAccountLabel(af)
    const exists = transactions.some((tx) => normalizeLedgerAccountLabel(tx.account) === afNorm)
    if (!exists) setLedgerAccountFilter(null)
  }, [transactions, ledgerAccountFilter, setLedgerAccountFilter])

  const ledgerCategoryChoices = useMemo(() => {
    const s = new Set()
    for (const tx of transactions) {
      const t = String(tx.category ?? '').trim()
      if (t) s.add(t)
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [transactions])

  const hasUncategorizedLedgerRows = useMemo(
    () => transactions.some((tx) => !String(tx.category ?? '').trim()),
    [transactions],
  )

  const periodDropdownModel = useMemo(() => {
    const years = new Set()
    const months = []
    const seenYm = new Set()
    for (const tx of transactions) {
      const cal = parseTxYearMonth(tx.date)
      if (!cal) continue
      years.add(cal.year)
      const key = `${cal.year}-${cal.month}`
      if (!seenYm.has(key)) {
        seenYm.add(key)
        months.push({ year: cal.year, month: cal.month })
      }
    }
    const sortedYears = [...years].sort((a, b) => b - a)
    months.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      return b.month - a.month
    })
    return { sortedYears, months }
  }, [transactions])

  const ledgerFilterHint = useMemo(() => {
    const parts = []
    if (ledgerPeriodPreset.kind !== 'all') {
      if (ledgerPeriodPreset.kind === 'year') parts.push(`기간 ${ledgerPeriodPreset.year}년`)
      else parts.push(`기간 ${ledgerPeriodPreset.year}년 ${ledgerPeriodPreset.month}월`)
    }
    if (ledgerAccountFilter?.trim()) parts.push(`계정 ${ledgerAccountFilter.trim()}`)
    if (ledgerCategoryFilter === LEDGER_CATEGORY_FILTER_UNASSIGNED) parts.push('항목 미지정')
    else if (ledgerCategoryFilter?.trim()) parts.push(`항목 ${ledgerCategoryFilter.trim()}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [ledgerPeriodPreset, ledgerAccountFilter, ledgerCategoryFilter])

  const selectCn =
    'min-w-[6.5rem] max-w-[10.5rem] px-2.5 py-1.5 rounded-full text-xs font-bold border border-surface-container bg-surface-container-low text-on-surface cursor-pointer hover:bg-surface-container outline-none focus-visible:ring-2 focus-visible:ring-primary/25 truncate'

  const aiFilterIdSet = useMemo(() => {
    if (!aiFilter?.ids) return null
    return new Set([...aiFilter.ids].map((id) => String(id)))
  }, [aiFilter])

  /** 기간·계정·항목(+ AI 검색 결과 한정 시 그 교집합)까지 적용한 풀 — 유형 칩(전체/검토/수입/지출) 적용 전 */
  const ledgerManualScopePool = useMemo(() => {
    const applyPeriodAccountCategory = (rows) => {
      let r = rows.filter((tx) => txMatchesLedgerPeriod(tx.date, ledgerPeriodPreset))
      if (ledgerAccountFilter && ledgerAccountFilter.trim()) {
        const afNorm = normalizeLedgerAccountLabel(ledgerAccountFilter)
        r = r.filter((tx) => normalizeLedgerAccountLabel(tx.account) === afNorm)
      }
      if (ledgerCategoryFilter === LEDGER_CATEGORY_FILTER_UNASSIGNED) {
        r = r.filter((tx) => !String(tx.category ?? '').trim())
      } else if (ledgerCategoryFilter?.trim()) {
        const cf = ledgerCategoryFilter.trim()
        r = r.filter((tx) => String(tx.category ?? '').trim() === cf)
      }
      return r
    }

    if (aiFilterIdSet) {
      return applyPeriodAccountCategory(transactions.filter((tx) => aiFilterIdSet.has(String(tx.id))))
    }
    return applyPeriodAccountCategory(transactions)
  }, [transactions, aiFilterIdSet, ledgerPeriodPreset, ledgerAccountFilter, ledgerCategoryFilter])

  const reviewCount = useMemo(() => {
    return ledgerManualScopePool.reduce((n, tx) => {
      if (tx.status === 'PENDING' || reviewPinnedTxIds.includes(tx.id)) return n + 1
      return n
    }, 0)
  }, [ledgerManualScopePool, reviewPinnedTxIds])

  const filteredTransactions = useMemo(() => {
    const pool = ledgerManualScopePool
    if (activeLedgerFilter === 'review') {
      return pool.filter((tx) => tx.status === 'PENDING' || reviewPinnedTxIds.includes(tx.id))
    }
    if (activeLedgerFilter === 'income') return pool.filter((tx) => tx.amount > 0)
    if (activeLedgerFilter === 'expense') return pool.filter((tx) => tx.amount < 0)
    return pool
  }, [ledgerManualScopePool, activeLedgerFilter, reviewPinnedTxIds])

  const aiMatchCount = useMemo(() => {
    if (!aiFilterIdSet) return 0
    return transactions.reduce((count, tx) => (aiFilterIdSet.has(String(tx.id)) ? count + 1 : count), 0)
  }, [transactions, aiFilterIdSet])

  const filteredNetAmount = useMemo(
    () => filteredTransactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0),
    [filteredTransactions],
  )

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

  useEffect(() => {
    const visible = new Set(sortedTransactions.map((t) => t.id))
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)))
      if (next.size !== prev.size) return next
      for (const id of prev) {
        if (!next.has(id)) return next
      }
      return prev
    })
  }, [sortedTransactions])

  const toggleTxSelected = (txId) => {
    const id = String(txId)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllInCurrentView = () => {
    setSelectedIds(new Set(sortedTransactions.map((t) => t.id)))
  }

  const clearRowSelection = () => setSelectedIds(new Set())

  const deleteSelectedRows = async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const ok = window.confirm(
      `선택한 ${ids.length}건을 원장에서 삭제할까요? 되돌리기 어려울 수 있습니다.`,
    )
    if (!ok) return
    for (const id of ids) {
      await deleteLine(id)
    }
    setSelectedIds(new Set())
  }

  const beginEdit = (txId, field, value) => {
    setEditingCell({ txId, field })
    setDraftValue(String(value ?? ''))
  }

  const commitEdit = (explicitValue) => {
    if (!editingCell) return
    const { txId, field } = editingCell
    const isEventLike =
      explicitValue != null &&
      typeof explicitValue === 'object' &&
      ('target' in explicitValue || 'currentTarget' in explicitValue || 'nativeEvent' in explicitValue)
    const source =
      explicitValue !== undefined && !isEventLike ? String(explicitValue) : draftValue
    const nextRaw = source.trim()
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
          </div>
          <div className="flex flex-wrap items-center w-full gap-y-2 gap-x-2">
            <div className="flex flex-wrap gap-2 items-center min-w-0 flex-1">
              <select
                aria-label="원장 기간"
                className={selectCn}
                value={ledgerPresetToSelectValue(ledgerPeriodPreset)}
                onChange={(e) => setLedgerPeriodPreset(selectValueToLedgerPreset(e.target.value))}
              >
                <option value="all">전체 기간</option>
                {periodDropdownModel.sortedYears.map((y) => (
                  <option key={`y-${y}`} value={`year:${y}`}>
                    {y}년 전체
                  </option>
                ))}
                {periodDropdownModel.months.map(({ year, month }) => (
                  <option key={`m-${year}-${month}`} value={`month:${year}-${String(month).padStart(2, '0')}`}>
                    {year}년 {month}월
                  </option>
                ))}
              </select>
              <FilterChip
                label="유형 전체"
                title="선택한 기간·계정 범위 안에서 수입·지출을 구분하지 않고 모두 표시합니다. 기간을 넓히려면 왼쪽에서 「전체 기간」을 고르세요."
                active={activeLedgerFilter === 'all'}
                onClick={() => setLedgerContextByFilter('all')}
              />
              <select
                aria-label="계정으로 필터"
                className={`${selectCn} max-w-[11rem]`}
                value={accountSelectValue}
                onChange={(e) => {
                  const raw = e.target.value === '' ? null : e.target.value
                  setLedgerAccountFilter(raw)
                  if (raw && activeLedgerFilter === 'review') setLedgerContextByFilter('all')
                }}
              >
                <option value="">전체 계정</option>
                {ledgerAccountChoices.map((acc) => (
                  <option key={acc} value={acc}>
                    {acc}
                  </option>
                ))}
              </select>
              <select
                aria-label="항목으로 필터"
                className={`${selectCn} max-w-[11rem]`}
                value={
                  ledgerCategoryFilter == null
                    ? ''
                    : ledgerCategoryFilter === LEDGER_CATEGORY_FILTER_UNASSIGNED
                      ? LEDGER_CATEGORY_FILTER_UNASSIGNED
                      : ledgerCategoryFilter
                }
                onChange={(e) => {
                  const v = e.target.value
                  setLedgerCategoryFilter(v === '' ? null : v)
                }}
              >
                <option value="">전체 항목</option>
                {hasUncategorizedLedgerRows ? (
                  <option value={LEDGER_CATEGORY_FILTER_UNASSIGNED}>항목 미지정</option>
                ) : null}
                {ledgerCategoryChoices.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <FilterChip
                label="수입"
                active={activeLedgerFilter === 'income'}
                onClick={() => setLedgerContextByFilter('income')}
              />
              <div className="flex flex-col items-start gap-1">
                <FilterChip
                  label="지출"
                  active={activeLedgerFilter === 'expense'}
                  onClick={() => setLedgerContextByFilter('expense')}
                />
                <button
                  type="button"
                  title={
                    activeLedgerFilter === 'review'
                      ? '다시 클릭하면 유형 전체(전체 원장)로 돌아갑니다.'
                      : '검토 대기 거래만 보기'
                  }
                  aria-pressed={activeLedgerFilter === 'review'}
                  onClick={() =>
                    setLedgerContextByFilter(activeLedgerFilter === 'review' ? 'all' : 'review')
                  }
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors shrink-0 ${
                    activeLedgerFilter === 'review'
                      ? 'bg-primary text-white'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  🚨 검토 필요 ({reviewCount})
                </button>
              </div>
            </div>
            <div
              className="flex flex-wrap gap-2 items-center justify-end shrink-0 ml-auto sm:border-l border-surface-container sm:pl-3"
              role="group"
              aria-label="선택한 거래 일괄 작업"
            >
              {selectedIds.size > 0 ? (
                <span className="text-[10px] font-bold text-primary tabular-nums shrink-0">
                  {selectedIds.size}건
                </span>
              ) : null}
              <button
                type="button"
                title="현재 목록에 보이는 거래를 모두 선택"
                onClick={selectAllInCurrentView}
                disabled={sortedTransactions.length === 0}
                className="text-[10px] font-bold px-2 py-1.5 rounded-lg border border-surface-container bg-surface-container-low text-on-surface-variant hover:bg-surface-container disabled:opacity-40 shrink-0"
              >
                전체 선택
              </button>
              <button
                type="button"
                title="선택 해제"
                onClick={clearRowSelection}
                disabled={selectedIds.size === 0}
                className="text-[10px] font-bold px-2 py-1.5 rounded-lg border border-surface-container bg-surface-container-low text-on-surface-variant hover:bg-surface-container disabled:opacity-40 shrink-0"
              >
                해제
              </button>
              <button
                type="button"
                title="선택한 거래 삭제"
                onClick={() => void deleteSelectedRows()}
                disabled={selectedIds.size === 0}
                className="text-[10px] font-bold px-2 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 shrink-0"
              >
                삭제
              </button>
            </div>
          </div>
          <div className="w-full mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-1.5">
              {ledgerFilterHint ? (
                <span className="text-[11px] text-primary/90 font-semibold truncate">
                  수동 필터: {ledgerFilterHint}
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-sm md:text-base font-extrabold tabular-nums text-[#6b3fd1] whitespace-nowrap">
              잔액: {filteredNetAmount.toLocaleString('ko-KR')}원
            </span>
          </div>
        </div>
      </div>

      <div className="ledger-scrollbar-scroll flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {groupedTransactions.length === 0 ? (
          <p className="py-10 px-2 text-center text-sm text-on-surface-variant leading-relaxed">
            조건에 맞는 거래가 없습니다.
            <span className="block mt-1 text-[11px]">
              「미분류/검토 대기」 보기에서는 검토 필요 건만 나옵니다. 계정별 전체 내역은 「유형 전체」 칩을 누른 뒤 다시 확인해 보세요.
            </span>
          </p>
        ) : (
          groupedTransactions.map((group) => (
          <div key={group.date} className="pt-2">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
              {group.items.map((tx, idx) => {
                const isHovered = hoveredTxId === tx.id
                return (
                  <div
                    key={tx.id}
                    onMouseEnter={() => setHoveredTx(tx.id)}
                    onMouseLeave={() => setHoveredTx(null)}
                    className={`px-2 md:px-2.5 py-1.5 bg-transparent transition-colors ${
                      isHovered ? 'bg-primary/[0.05]' : 'hover:bg-surface-container-low/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className="w-[74px] shrink-0 text-[11px] text-gray-500 tabular-nums">
                        {idx === 0 ? fmtDateCompact(group.date) : '\u00A0'}
                      </div>
                      <label
                        className="-ml-0.5 shrink-0 inline-flex items-center cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(tx.id)}
                          onChange={() => toggleTxSelected(tx.id)}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                          aria-label={`${tx.name || '거래'} 선택`}
                        />
                      </label>
                      <div className="w-[70px] shrink-0 text-[10px] text-gray-500 truncate">
                        {buildSourceLabel(tx)}
                      </div>

                      <div className="min-w-[128px]">
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
                      </div>

                      <div className="flex-[0.68] min-w-[80px] max-w-[170px] px-0.5">
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

                      <div className="ml-auto flex items-center gap-1 pr-0.5">
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
                            className="px-1.5 py-0.5 bg-surface-container-low text-on-surface-variant text-[11px] rounded-full font-semibold cursor-text"
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
                            className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full font-extrabold cursor-text"
                          >
                            {tx.category}
                          </span>
                        ) : (
                          <span
                            onDoubleClick={() => beginEdit(tx.id, 'category', '')}
                            className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[11px] rounded-full font-bold cursor-text"
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
                            className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] rounded-full font-bold hover:bg-red-200/90 transition-colors"
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
          ))
        )}
      </div>
    </div>
  )
}

/** 필터 문자열과 겹치는 계정을 위로 올리고 나머지도 함께 보여 줌 — 수정 모드에서도 전체 드롭다운 유지 */
function sortAccountsForPicker(accounts, filterText) {
  const raw = [...accounts]
  const term = String(filterText || '').trim().toLowerCase()
  if (!term) return raw.sort((a, b) => a.localeCompare(b, 'ko'))
  const hits = raw.filter((a) => a.toLowerCase().includes(term))
  const rest = raw.filter((a) => !a.toLowerCase().includes(term))
  hits.sort((a, b) => a.localeCompare(b, 'ko'))
  rest.sort((a, b) => a.localeCompare(b, 'ko'))
  return [...hits, ...rest]
}

function FilterChip({ label, active, onClick, title }) {
  return (
    <button
      type="button"
      title={title}
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
      onBlur={() => onCommit()}
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
        width: Math.max(r.width, 168),
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

  const orderedAccounts = useMemo(
    () => sortAccountsForPicker(suggestedAccounts, value),
    [suggestedAccounts, value],
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
      {orderedAccounts.length > 0 && dropRect && createPortal(
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
          {orderedAccounts.map((acct) => (
            <button
              key={acct}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                setValue(acct)
                onCommit(acct)
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
