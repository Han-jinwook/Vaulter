import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useAssetStore, selectAssetLines } from '../stores/assetStore'
import { useAssetStats, formatKRW, getCurrentMonthLabel } from '../selectors/vaultSelectors'
import { AssetAccordionList, DebtAccordionList } from '../components/assets/GoldenAssetLists'
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_CHART_COLOR,
  LIQUIDITY_CHART_COLOR,
} from '../lib/goldenAssetCategories'

export default function AssetsPage() {
  const lines = useAssetStore((s) => s.lines)
  const { cumulativeBalance, thisMonthFlow, hasData } = useAssetStats()

  const assets = useMemo(() => selectAssetLines(lines, 'ASSET'), [lines])
  const debts = useMemo(() => selectAssetLines(lines, 'DEBT'), [lines])

  const sumAssets = useMemo(() => assets.reduce((s, a) => s + a.amount, 0), [assets])
  const sumDebts = useMemo(() => debts.reduce((s, d) => s + d.amount, 0), [debts])

  /** 총 평가금액 = (유동성 + 고정 자산) − 부채 */
  const totalNet = cumulativeBalance + sumAssets - sumDebts

  const allocation = useMemo(() => {
    const liq = Math.max(0, cumulativeBalance)
    const byCat = new Map()
    for (const a of assets) {
      byCat.set(a.category, (byCat.get(a.category) ?? 0) + a.amount)
    }
    const rows = []
    if (liq > 0) {
      rows.push({ name: '현금/유동성', value: liq, color: LIQUIDITY_CHART_COLOR })
    }
    for (const cat of ASSET_CATEGORIES) {
      const amt = byCat.get(cat) ?? 0
      if (amt > 0) {
        rows.push({ name: cat, value: amt, color: ASSET_CATEGORY_CHART_COLOR[cat] })
      }
    }
    if (rows.length === 0) {
      return [{ name: hasData ? '원장 집계' : '데이터 없음', value: 1, color: '#333' }]
    }
    return rows
  }, [cumulativeBalance, assets, hasData])

  const chartOption = useMemo(() => {
    return {
      backgroundColor: 'transparent',
      legend: {
        type: 'scroll',
        bottom: 4,
        left: 'center',
        data: allocation.map((a) => a.name),
        textStyle: { color: 'rgba(237,237,237,0.85)', fontSize: 10 },
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 8,
        pageTextStyle: { color: 'rgba(237,237,237,0.55)' },
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1a1a1a',
        borderColor: '#FFD700',
        borderWidth: 1,
        textStyle: { color: '#EDEDED' },
        formatter: (params) =>
          `${params.name}<br/>₩${Number(params.value).toLocaleString('ko-KR')} (${params.percent}%)`,
      },
      series: [
        {
          type: 'pie',
          radius: ['50%', '78%'],
          center: ['50%', '44%'],
          padAngle: 2,
          minAngle: 4,
          itemStyle: {
            borderRadius: 10,
            borderColor: '#121212',
            borderWidth: 2,
          },
          label: { show: true, color: '#EDEDED', fontSize: 11, formatter: '{b}' },
          emphasis: {
            scale: true,
            scaleSize: 10,
            itemStyle: { shadowBlur: 22, shadowColor: 'rgba(255,215,0,0.42)' },
          },
          data: allocation.map((a) => ({
            value: a.value,
            name: a.name,
            itemStyle:
              a.name === '현금/유동성'
                ? {
                    color: a.color,
                    shadowBlur: 16,
                    shadowColor: 'rgba(255,215,0,0.35)',
                  }
                : { color: a.color },
          })),
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: '44%',
          style: {
            text: '황금자산',
            fill: '#F1C40F',
            fontSize: 12,
            fontWeight: 600,
          },
        },
        {
          type: 'text',
          left: 'center',
          top: '52%',
          style: {
            text: `₩${Math.round(totalNet / 1000)}K`,
            fill: '#FFD700',
            fontSize: 18,
            fontWeight: 800,
          },
        },
      ],
    }
  }, [allocation, totalNet])

  const flowTone = thisMonthFlow >= 0 ? 'text-teal-400' : 'text-rose-300'
  const flowPrefix = thisMonthFlow >= 0 ? '+' : ''

  return (
    <div className="-mx-4 md:-mx-8 px-4 md:px-8 py-6 min-h-full space-y-6 bg-surface text-on-surface">
      <section className="bg-gradient-to-br from-[#1a1a1a] to-[#121212] rounded-t-3xl rounded-b-2xl p-8 shadow-[0_8px_28px_rgba(0,0,0,0.45)] border border-[#FFD700]/20">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <p className="text-xs text-[#F1C40F]/90 font-bold tracking-widest uppercase">황금자산 포트폴리오</p>
            <h1 className={`text-3xl md:text-4xl font-extrabold tabular-nums mt-1 ${totalNet >= 0 ? 'text-[#FFD700]' : 'text-rose-300'}`}>
              {totalNet < 0 ? '-' : ''}
              {formatKRW(totalNet)}
            </h1>
            <p className="text-xs text-[#EDEDED]/55 mt-1">유동성(원장) + 등록 자산 − 등록 부채</p>
          </div>
          <span className="px-3 py-1 rounded-full bg-[#FFD700]/10 text-[#F1C40F] text-xs font-bold border border-[#FFD700]/25">
            {getCurrentMonthLabel()}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#121212]/90 border border-[#26334D]/30 rounded-2xl p-5">
            <p className="text-[11px] text-[#EDEDED]/50 font-bold mb-1">총 평가금액</p>
            <p className={`text-xl font-bold tabular-nums ${totalNet >= 0 ? 'text-[#FFD700]' : 'text-rose-300'}`}>
              {totalNet < 0 ? '-' : ''}
              {formatKRW(totalNet)}
            </p>
          </div>
          <div className="bg-[#121212]/90 border border-[#26334D]/30 rounded-2xl p-5">
            <p className="text-[11px] text-[#EDEDED]/50 font-bold mb-1">이번 달 원장 증감</p>
            <p className={`text-xl font-bold tabular-nums ${flowTone}`}>
              {flowPrefix}
              {formatKRW(thisMonthFlow)}
            </p>
            <p className="text-[10px] text-[#EDEDED]/40 mt-1">지기 탭 거래 기준 (현금 흐름)</p>
          </div>
          <div className="bg-[#121212]/90 border border-[#26334D]/30 rounded-2xl p-5">
            <p className="text-[11px] text-[#EDEDED]/50 font-bold mb-1">누적 가용 자금</p>
            <p className={`text-xl font-bold tabular-nums ${cumulativeBalance >= 0 ? 'text-[#FFD700]' : 'text-rose-300'}`}>
              {cumulativeBalance < 0 ? '-' : ''}
              {formatKRW(cumulativeBalance)}
            </p>
            <p className="text-[10px] text-[#EDEDED]/40 mt-1">원장 수입 − 지출</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-6">
        <section className="bg-[#232323] rounded-t-3xl rounded-b-2xl p-6 shadow-[0_12px_32px_rgba(0,0,0,0.4)] border border-[#26334D]/20">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-[#EDEDED]">
            <span className="material-symbols-outlined text-[#F1C40F]">donut_large</span>
            카테고리 비중
          </h2>
          <p className="text-[11px] text-[#EDEDED]/45 mb-3">현금/유동성(원장) + 자산 스토어 카테고리 합계 기준</p>
          <div className="rounded-2xl bg-gradient-to-br from-[#1f1f1f] to-[#171717] border border-[#26334D]/25 p-4">
            <ReactECharts option={chartOption} style={{ height: 360, width: '100%' }} notMerge lazyUpdate />
          </div>
        </section>

        <div className="p-[1px] rounded-t-3xl rounded-b-2xl bg-[#FFD700]/40 shadow-[0_12px_32px_rgba(0,0,0,0.4)]">
          <section className="bg-[#232323] rounded-t-3xl rounded-b-2xl p-6 h-full border border-transparent">
            <h2
              className="text-lg mb-3 flex items-center gap-2 text-[#EDEDED]"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700 }}
            >
              <span className="material-symbols-outlined text-[#F1C40F]">summarize</span>
              요약
            </h2>
            <ul className="space-y-3 text-sm text-[#EDEDED]/85">
              <li className="rounded-xl bg-[#121212] border border-[#26334D]/25 p-3">
                등록 자산 합계: <span className="font-bold text-[#FFD700]">{formatKRW(sumAssets)}</span>
              </li>
              <li className="rounded-xl bg-[#121212] border border-rose-900/25 p-3">
                등록 부채 합계: <span className="font-bold text-rose-300">−{formatKRW(sumDebts)}</span>
              </li>
              <li className="rounded-xl bg-[#121212] border border-[#FFD700]/20 p-3">
                부채 상환 후 순자산 지표는 상단 총 평가금액을 기준으로 삼습니다.
              </li>
            </ul>
          </section>
        </div>
      </div>

      {/* 하단: 아코디언 리스트 (지기 원장과 독립) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AssetAccordionList liquidityAmount={cumulativeBalance} />
        <DebtAccordionList />
      </div>
    </div>
  )
}

