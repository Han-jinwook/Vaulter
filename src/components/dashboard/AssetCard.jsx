import { useState, useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useAssetStats, formatKRW, getCurrentMonthLabel } from '../../selectors/vaultSelectors'

const vaultPrompts = [
  { emoji: '🧾', text: '오늘 먹은 점심 영수증 보관하기' },
  { emoji: '🧾', text: '이번 달 카드 명세서 던져넣기' },
  { emoji: '📑', text: '전세 임대차 계약서 안전하게 넣기' },
  { emoji: '📑', text: '연말정산 서류 금고에 보관하기' },
  { emoji: '🚨', text: '과태료·벌금 고지서 기록해두기' },
  { emoji: '🚨', text: '아파트 관리비 명세서 보관하기' },
  { emoji: '✈️', text: '올여름 가족 여행 예산안 짜보기' },
]

export default function AssetCard({ isExpanded = true }) {
  const { openUpload, restoreTrinityMode } = useUIStore()
  const [idx, setIdx] = useState(0)
  const [hovered, setHovered] = useState(false)

  const {
    hasData,
    cumulativeBalance,
    thisMonthFlow,
    thisMonthIncome,
    thisMonthExpense,
    expenseChangeRate,
  } = useAssetStats()

  // 전월 대비 지출 증감 배지
  const trendBadge = (() => {
    if (expenseChangeRate === null) return null
    const sign = expenseChangeRate >= 0 ? '+' : ''
    return {
      label: `전월 대비 지출 ${sign}${expenseChangeRate.toFixed(1)}%`,
      icon: expenseChangeRate >= 0 ? 'trending_up' : 'trending_down',
      colorClass: expenseChangeRate >= 0 ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary',
    }
  })()

  useEffect(() => {
    if (hovered) return
    const timer = setInterval(() => {
      setIdx((i) => (i + 1) % vaultPrompts.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [hovered])

  const cur = vaultPrompts[idx]

  if (!isExpanded) {
    return (
      <div
        className="bg-surface-container-lowest rounded-t-3xl rounded-b-2xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] min-h-[420px] h-full p-2 transition-all duration-500 ease-in-out flex flex-col items-center gap-2"
        onClick={restoreTrinityMode}
      >
        <button
          onClick={restoreTrinityMode}
          className="w-full h-12 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors flex items-center justify-center"
          title="패널 복구"
        >
          <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
        </button>

        <button
          onClick={() => {
            restoreTrinityMode()
            openUpload()
          }}
          className="w-full flex-1 rounded-lg bg-gradient-to-b from-primary to-primary-dim text-white font-bold shadow-md shadow-primary/20 flex items-center justify-center px-1"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.04em' }}
          title="금고에 입금"
        >
          + 영수증 보관하기
        </button>
      </div>
    )
  }

  return (
    <div className="bg-surface-container-lowest rounded-t-3xl rounded-b-2xl p-6 md:p-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between relative overflow-hidden group min-h-[396px]">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-4 opacity-[0.07] group-hover:scale-110 transition-transform duration-500">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: '140px' }}>
          payments
        </span>
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-outline tracking-widest uppercase">누적 가용 자금</span>
          <span className="px-2 py-0.5 bg-primary-container text-on-primary-container text-[10px] rounded-full font-bold">
            {getCurrentMonthLabel()}
          </span>
        </div>

        {/* Main Balance */}
        {hasData ? (
          <>
            <h1 className={`text-4xl font-extrabold tracking-tight tabular-nums ${cumulativeBalance >= 0 ? 'text-on-surface' : 'text-error'}`}>
              {cumulativeBalance < 0 ? '-' : ''}{formatKRW(cumulativeBalance)}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <div className="text-on-surface-variant font-semibold">
                이번 달 수입 <span className="tabular-nums text-primary">{formatKRW(thisMonthIncome)}</span>
              </div>
              <span className="text-outline">|</span>
              <div className="text-on-surface-variant font-semibold">
                이번 달 지출 <span className="tabular-nums text-secondary">{formatKRW(thisMonthExpense)}</span>
              </div>
              {trendBadge && (
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 ${trendBadge.colorClass}`}>
                  <span className="material-symbols-outlined text-sm">{trendBadge.icon}</span>
                  {trendBadge.label}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-extrabold text-outline/40 tracking-tight">₩ — — —</h1>
            <p className="mt-2 text-sm text-outline">영수증을 던져넣으면 금고가 살아납니다!</p>
          </>
        )}

        {/* Sub stats */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="bg-surface-container-low p-3.5 rounded-xl">
            <div className="text-[10px] text-outline font-bold mb-1">이번 달 금고 결산</div>
            {hasData ? (
              <div className={`text-lg font-bold tabular-nums ${thisMonthFlow >= 0 ? 'text-primary' : 'text-error'}`}>
                {thisMonthFlow >= 0 ? '+' : '-'}{formatKRW(thisMonthFlow)}
              </div>
            ) : (
              <div className="text-lg font-bold text-outline/40">—</div>
            )}
          </div>
          <div className="bg-surface-container-low p-3.5 rounded-xl">
            <div className="text-[10px] text-outline font-bold mb-1">이번 달 총 지출</div>
            {hasData ? (
              <div className="text-lg font-bold tabular-nums">{formatKRW(thisMonthExpense)}</div>
            ) : (
              <div className="text-lg font-bold text-outline/40">—</div>
            )}
          </div>
        </div>
      </div>

      {/* Dynamic Vault Drop Button */}
      <button
        onClick={openUpload}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="mt-5 relative z-10 w-full bg-gradient-to-r from-primary to-primary-dim text-white py-4.5 px-5 rounded-2xl font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-shadow duration-300 hover:shadow-xl hover:shadow-primary/30 cursor-pointer"
      >
        {hovered ? (
          <div className="animate-fade-in">
            <div className="flex items-center justify-center gap-2.5 h-6">
              <span className="material-symbols-outlined text-xl">folder_open</span>
              <span>클릭하거나 파일을 여기로 드래그하세요</span>
            </div>
            <div className="mt-2 text-[11px] font-medium text-white/85">
              이미지, CSV, XLS/XLSX, 텍스트 PDF 지원
            </div>
          </div>
        ) : (
          <div>
            <div className="h-6 overflow-hidden relative">
              <div key={idx} className="flex items-center justify-center gap-2.5 h-6 animate-vault-text">
                <span>{cur.emoji}</span>
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-white/60 text-lg">add</span>
                  {cur.text}
                </span>
              </div>
            </div>
            <div className="mt-2 text-[11px] font-medium text-white/85">
              이미지, CSV, XLS/XLSX, 텍스트 PDF 지원
            </div>
          </div>
        )}
      </button>
    </div>
  )
}
