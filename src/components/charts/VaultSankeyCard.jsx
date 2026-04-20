import { useMemo, useState, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import { useUIStore } from '../../stores/uiStore'

// ── 날짜 파싱 ─────────────────────────────────────────────────────────────────
function txDate(tx) {
  if (typeof tx?.date === 'string') {
    const d = new Date(tx.date.replaceAll('.', '-'))
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

// ── 기간 필터 ─────────────────────────────────────────────────────────────────
function filterByPeriod(transactions, period) {
  const now = new Date()

  if (period === 'last_7d') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return transactions.filter((tx) => {
      const d = txDate(tx)
      return d && d >= start && d <= now
    })
  }

  if (period === 'this_month') {
    return transactions.filter((tx) => {
      const d = txDate(tx)
      return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    })
  }

  return transactions
}

// ── AI 지정 기간 필터 (startDate/endDate 문자열) ──────────────────────────────
function filterByCustomRange(transactions, startDate, endDate) {
  const start = new Date(startDate)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)
  return transactions.filter((tx) => {
    const d = txDate(tx)
    return d && d >= start && d <= end
  })
}

// ── 카테고리별 색상 팔레트 (토스 스타일) ─────────────────────────────────────
const PALETTE = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#F97316', '#EC4899', '#84CC16', '#6366F1',
]

const periodOptions = [
  { key: 'last_7d', label: '최근 7일' },
  { key: 'this_month', label: '이번 달' },
]

export default function VaultSankeyCard({ transactions = [], chartHeight = 220 }) {
  const [period, setPeriod] = useState('last_7d')
  const isLeftExpanded = useUIStore((s) => s.isLeftExpanded)
  const isChartMode = useUIStore((s) => s.isChartMode)
  const vizFilter = useUIStore((s) => s.vizFilter)
  const clearVizFilter = useUIStore((s) => s.clearVizFilter)

  // ECharts 리사이즈 트리거 (패널 전환 시)
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 520)
    return () => clearTimeout(t)
  }, [isLeftExpanded, isChartMode])

  // ── 집계 ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    // AI가 vizFilter를 지정했으면 그 기간 우선, 아니면 토글 버튼 기간 사용
    const filtered = vizFilter
      ? filterByCustomRange(transactions, vizFilter.startDate, vizFilter.endDate)
      : filterByPeriod(transactions, period)
    let income = 0
    let expense = 0
    const catMap = {}

    for (const tx of filtered) {
      if (tx.type === 'TRANSFER') continue
      const amt = Number(tx.amount) || 0
      if (amt > 0) {
        income += amt
      } else {
        expense += Math.abs(amt)
        const cat = tx.category || '미분류'
        catMap[cat] = (catMap[cat] || 0) + Math.abs(amt)
      }
    }

    const categories = Object.entries(catMap)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value], i) => ({
        name,
        value,
        color: PALETTE[i % PALETTE.length],
        pct: expense > 0 ? ((value / expense) * 100).toFixed(1) : '0.0',
      }))

    const periodLabel = vizFilter?.label ?? (period === 'last_7d' ? '최근 7일' : '이번 달')

    // 소제목: 데이터 구성에 따라 "지출 분석" / "수입 분석" / "수입/지출 분석"
    let analysisLabel
    if (income > 0 && expense > 0) analysisLabel = '수입/지출 분석'
    else if (income > 0) analysisLabel = '수입 분석'
    else analysisLabel = '지출 분석'

    return {
      income,
      expense,
      net: income - expense,
      categories,
      hasData: filtered.length > 0,
      periodLabel,
      analysisLabel,
      subtitle: `${periodLabel} ${analysisLabel}`,
    }
  }, [transactions, period, vizFilter])

  // ── ECharts 도넛 옵션 ──────────────────────────────────────────────────────
  const option = useMemo(() => {
    if (!stats.categories.length) return null
    const donutHeight = Math.max(chartHeight - 110, 120)

    return {
      animation: true,
      animationDuration: 400,
      tooltip: {
        trigger: 'item',
        backgroundColor: '#ffffff',
        borderColor: '#e5e9eb',
        borderWidth: 1,
        textStyle: { color: '#2c2f31', fontSize: 12 },
        formatter: (p) =>
          `${p.name}<br/>₩${Number(p.value).toLocaleString('ko-KR')} <b>(${p.percent?.toFixed(1)}%)</b>`,
      },
      series: [
        {
          type: 'pie',
          radius: ['50%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          data: stats.categories.map((c) => ({
            name: c.name,
            value: c.value,
            itemStyle: { color: c.color, borderRadius: 4, borderWidth: 2, borderColor: '#f8f9fa' },
          })),
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.15)' },
          },
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '42%',
          style: {
            text: `₩${Math.round(stats.expense / 1000)}K`,
            fontSize: 13,
            fontWeight: 'bold',
            fill: '#2c2f31',
            textAlign: 'center',
          },
        },
        {
          type: 'text',
          left: 'center',
          top: '54%',
          style: {
            text: '총 지출',
            fontSize: 10,
            fill: '#747779',
            textAlign: 'center',
          },
        },
      ],
    }
  }, [stats, chartHeight])

  const donutH = Math.max(chartHeight - 110, 120)

  return (
    <div className="bg-surface-container-low p-4 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-[11px] font-bold text-outline tracking-wider flex items-center gap-1.5">
          {stats.subtitle}
          {vizFilter && (
            <button
              onClick={clearVizFilter}
              className="text-[9px] text-outline hover:text-error transition-colors"
              title="AI 기간 해제"
            >
              ✕
            </button>
          )}
        </h4>
        <div className="flex items-center gap-1 bg-surface-container rounded-full p-1">
          {periodOptions.map((p) => (
            <button
              key={p.key}
              onClick={() => { clearVizFilter(); setPeriod(p.key) }}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${
                !vizFilter && period === p.key
                  ? 'bg-primary text-white'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 수입 / 지출 / 잔액 요약 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-primary/[0.06] rounded-xl p-2.5 text-center">
          <div className="text-[9px] text-outline font-bold mb-0.5">수입</div>
          <div className="text-[11px] font-bold text-primary tabular-nums">
            +₩{stats.income.toLocaleString('ko-KR')}
          </div>
        </div>
        <div className="bg-error/[0.06] rounded-xl p-2.5 text-center">
          <div className="text-[9px] text-outline font-bold mb-0.5">지출</div>
          <div className="text-[11px] font-bold text-error tabular-nums">
            -₩{stats.expense.toLocaleString('ko-KR')}
          </div>
        </div>
        <div
          className={`rounded-xl p-2.5 text-center ${
            stats.net >= 0 ? 'bg-primary/[0.06]' : 'bg-error/[0.06]'
          }`}
        >
          <div className="text-[9px] text-outline font-bold mb-0.5">잔액</div>
          <div
            className={`text-[11px] font-bold tabular-nums ${
              stats.net >= 0 ? 'text-primary' : 'text-error'
            }`}
          >
            {stats.net >= 0 ? '+' : ''}₩{Math.abs(stats.net).toLocaleString('ko-KR')}
          </div>
        </div>
      </div>

      {/* 도넛 차트 + 카테고리 범례 */}
      {stats.categories.length > 0 && option ? (
        <div className="flex items-center gap-3">
          {/* 도넛 */}
          <div className="shrink-0" style={{ width: donutH, height: donutH }}>
            <ReactECharts
              option={option}
              style={{ width: donutH, height: donutH }}
              notMerge
              lazyUpdate
            />
          </div>

          {/* 범례 */}
          <div className="flex-1 min-w-0 space-y-1.5 overflow-hidden">
            {stats.categories.map((cat) => (
              <div key={cat.name} className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-[11px] text-on-surface-variant truncate flex-1">
                  {cat.name}
                </span>
                <span className="text-[11px] font-bold text-on-surface tabular-nums shrink-0">
                  {cat.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg bg-surface-container-high/50 flex flex-col items-center justify-center gap-1 text-xs text-outline"
          style={{ height: donutH }}
        >
          <span className="material-symbols-outlined text-2xl opacity-30">bar_chart</span>
          <span>{stats.periodLabel} 내역이 없습니다.</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] text-outline">
        <span>{stats.subtitle}</span>
        <span>as of {new Date().toISOString().slice(0, 10)}</span>
      </div>
    </div>
  )
}
