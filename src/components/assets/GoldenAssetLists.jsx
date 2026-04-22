import { useMemo, useState } from 'react'
import { useAssetStore, selectAssetLines } from '../../stores/assetStore'
import { formatKRW } from '../../selectors/vaultSelectors'
import { coerceToYmd, formatYmdAsOfLabel } from '../../lib/ymdDate'
import {
  ASSET_CATEGORIES,
  DEBT_CATEGORIES,
  groupLinesByCategoryOrdered,
} from '../../lib/goldenAssetCategories'

function amountTrendClass(isDebt, delta) {
  if (delta == null) return 'text-[#C4B5A0]'
  if (isDebt) {
    if (delta > 0) return 'text-rose-400'
    if (delta < 0) return 'text-emerald-400/90'
  } else {
    if (delta > 0) return 'text-emerald-400'
    if (delta < 0) return 'text-rose-300/95'
  }
  return 'text-[#F1C40F]'
}

function useHistoryTimelineItems(line) {
  return useMemo(() => {
    if (!line?.history?.length) return []
    /** 최신이 위(인덱스 0) — 내림차순 */
    const desc = [...line.history].sort((a, b) =>
      coerceToYmd(b.date).localeCompare(coerceToYmd(a.date)),
    )
    return desc.map((h, i) => {
      const older = desc[i + 1]
      const olderAmt = older?.amount
      const delta =
        older != null && typeof h.amount === 'number' && typeof olderAmt === 'number'
          ? h.amount - olderAmt
          : null
      return {
        dateStr: coerceToYmd(h.date),
        amount: h.amount,
        memo: h.memo,
        trendDelta: delta,
      }
    })
  }, [line])
}

function InlineHistoryTimeline({ line, isDebt }) {
  const items = useHistoryTimelineItems(line)
  if (items.length === 0) {
    return <p className="text-xs text-[#6b7280] py-2">저장된 변동 이력이 없습니다.</p>
  }
  return (
    <div className="border-l-2 border-amber-500/70 pl-3 ml-1.5">
      <ul className="space-y-3">
        {items.map((row, idx) => (
          <li key={`${row.dateStr}-${idx}`} className="relative pl-0">
            <p className="text-xs font-mono text-[#9A8B6E] tabular-nums">{row.dateStr}</p>
            <p
              className={`text-sm font-bold tabular-nums mt-0.5 ${
                row.trendDelta != null
                  ? amountTrendClass(!!isDebt, row.trendDelta)
                  : isDebt
                    ? 'text-rose-200'
                    : 'text-[#FFD700]'
              }`}
            >
              {isDebt ? '−' : ''}
              {formatKRW(row.amount)}
            </p>
            <p className="text-xs sm:text-sm text-[#A89B7E] mt-1.5 leading-relaxed whitespace-pre-wrap break-words">
              {row.memo}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AccordionBlock({ title, icon, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-[#FFD700]/15 bg-[#1a1a1a] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-white/[0.04] transition-colors"
      >
        <span className="flex items-center gap-2 text-[#EDEDED] font-bold text-sm">
          <span className="material-symbols-outlined text-[#F1C40F] text-lg">{icon}</span>
          {title}
        </span>
        <span
          className="material-symbols-outlined text-[#EDEDED]/60 text-xl transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          expand_more
        </span>
      </button>
      {open && <div className="border-t border-[#26334D]/40 px-4 py-3 bg-[#121212]/80">{children}</div>}
    </div>
  )
}

function AssetLineItem({ line, isDebt, expandedItemId, setExpandedItemId }) {
  const asOfLabel = formatYmdAsOfLabel(line.asOfDate)
  const isOpen = expandedItemId === line.id
  const nameId = `asset-line-${line.id}`

  return (
    <li className="list-none">
      <div
        className={`rounded-xl border overflow-hidden transition-shadow duration-300
          ${
            isDebt
              ? 'border-rose-900/30 bg-[#232323]'
              : 'border-[#26334D]/25 bg-[#232323]'
          }
          ${isOpen ? 'ring-1 ring-amber-500/25' : ''}`}
      >
        <button
          type="button"
          onClick={() => setExpandedItemId((id) => (id === line.id ? null : line.id))}
          aria-expanded={isOpen}
          aria-controls={`history-panel-${line.id}`}
          aria-labelledby={nameId}
          className="w-full text-left flex items-start justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-zinc-800/80 active:scale-[0.998] transition-all duration-200"
        >
          <div className="min-w-0 flex-1 flex items-start gap-1.5">
            <span
              className="material-symbols-outlined text-[#C9A227] text-[20px] shrink-0 mt-0.5 transition-transform duration-300 ease-out"
              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              aria-hidden
            >
              expand_more
            </span>
            <div className="min-w-0">
              <p id={nameId} className="text-sm text-[#EDEDED] font-medium truncate">
                {line.name}
              </p>
              {line.memo != null && String(line.memo).trim() !== '' ? (
                <p className="text-sm text-gray-400 mt-0.5 leading-snug whitespace-pre-wrap break-words">
                  {String(line.memo).trim()}
                </p>
              ) : null}
            </div>
          </div>
          <div className="text-right shrink-0 pt-0.5 max-w-[48%]">
            <p className={`text-sm font-bold tabular-nums ${isDebt ? 'text-rose-300' : 'text-[#FFD700]'}`}>
              {isDebt ? '−' : ''}
              {formatKRW(line.amount)}
            </p>
            {asOfLabel ? (
              <p className="text-xs text-[#6b7280] mt-0.5 leading-tight">{asOfLabel}</p>
            ) : null}
          </div>
        </button>

        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out ${
            isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div
              id={`history-panel-${line.id}`}
              role="region"
              className="border-t border-white/[0.05] bg-[#181818]/90 px-3 py-2.5"
            >
              <p className="text-[10px] font-semibold text-[#C9A227]/80 uppercase tracking-widest mb-2">
                변동 이력
              </p>
              <InlineHistoryTimeline line={line} isDebt={isDebt} />
            </div>
          </div>
        </div>
      </div>
    </li>
  )
}

/** 현금/유동성 — vault 누적 가용 자금 (읽기 전용) */
export function LiquidityReadOnlyCard({ cumulativeBalance }) {
  return (
    <div className="rounded-2xl border border-[#FFD700]/35 bg-gradient-to-br from-[#1f1a0a] to-[#121212] p-4 shadow-[0_0_20px_rgba(255,215,0,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-wider text-[#F1C40F]/90 uppercase">현금 / 유동성</p>
          <p className="text-xs text-[#EDEDED]/70 mt-1">지기 원장에서 계산된 누적 가용 자금 (수정 불가)</p>
        </div>
        <span className="material-symbols-outlined text-[#FFD700]/50 text-xl shrink-0">account_balance_wallet</span>
      </div>
      <p
        className={`text-2xl font-extrabold tabular-nums mt-3 ${cumulativeBalance >= 0 ? 'text-[#FFD700]' : 'text-red-400'}`}
      >
        {cumulativeBalance < 0 ? '-' : ''}
        {formatKRW(cumulativeBalance)}
      </p>
    </div>
  )
}

export function AssetAccordionList({ liquidityAmount }) {
  const [expandedItemId, setExpandedItemId] = useState(null)
  const lines = useAssetStore((s) => s.lines)
  const assets = useMemo(() => selectAssetLines(lines, 'ASSET'), [lines])
  const groups = useMemo(
    () => groupLinesByCategoryOrdered(assets, 'ASSET', ASSET_CATEGORIES),
    [assets],
  )

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-[#EDEDED] flex items-center gap-2 px-1">
        <span className="material-symbols-outlined text-[#F1C40F]">savings</span>
        나의 자산
      </h2>
      <LiquidityReadOnlyCard cumulativeBalance={liquidityAmount} />
      {groups.map(([category, rows]) => (
        <AccordionBlock key={category} title={category} icon="folder_special" defaultOpen={false}>
          <ul className="space-y-2">
            {rows.map((r) => (
              <AssetLineItem
                key={r.id}
                line={r}
                isDebt={false}
                expandedItemId={expandedItemId}
                setExpandedItemId={setExpandedItemId}
              />
            ))}
          </ul>
        </AccordionBlock>
      ))}
    </section>
  )
}

export function DebtAccordionList() {
  const [expandedItemId, setExpandedItemId] = useState(null)
  const lines = useAssetStore((s) => s.lines)
  const debts = useMemo(() => selectAssetLines(lines, 'DEBT'), [lines])
  const groups = useMemo(
    () => groupLinesByCategoryOrdered(debts, 'DEBT', DEBT_CATEGORIES),
    [debts],
  )

  if (groups.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-[#EDEDED] flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-rose-300">credit_card</span>
          나의 부채
        </h2>
        <p className="text-sm text-[#EDEDED]/50 px-1">등록된 부채가 없습니다.</p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-[#EDEDED] flex items-center gap-2 px-1">
        <span className="material-symbols-outlined text-rose-300">credit_card</span>
        나의 부채
      </h2>
      {groups.map(([category, rows]) => (
        <AccordionBlock key={category} title={category} icon="request_quote" defaultOpen={false}>
          <ul className="space-y-2">
            {rows.map((r) => (
              <AssetLineItem
                key={r.id}
                line={r}
                isDebt
                expandedItemId={expandedItemId}
                setExpandedItemId={setExpandedItemId}
              />
            ))}
          </ul>
        </AccordionBlock>
      ))}
    </section>
  )
}
