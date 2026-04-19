import { useState, useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'

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
        className="bg-surface-container-lowest rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] min-h-[420px] h-full p-2 transition-all duration-500 ease-in-out flex flex-col items-center gap-2"
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
    <div className="bg-surface-container-lowest rounded-xl p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col justify-between relative overflow-hidden group min-h-[420px]">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-6 opacity-[0.07] group-hover:scale-110 transition-transform duration-500">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: '140px' }}>
          payments
        </span>
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-outline tracking-widest uppercase">나의 순자산</span>
          <span className="px-2 py-0.5 bg-primary-container text-on-primary-container text-[10px] rounded-full font-bold">
            2026년 4월 기준
          </span>
        </div>

        {/* Main Balance */}
        <h1 className="text-4xl font-extrabold text-on-surface tracking-tight tabular-nums">₩8,000,000</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <div className="text-on-surface-variant font-semibold">
            총 자산 <span className="tabular-nums text-on-surface">₩12,450,000</span>
          </div>
          <span className="text-outline">|</span>
          <div className="text-on-surface-variant font-semibold">
            총 부채 <span className="tabular-nums text-secondary">₩4,450,000</span>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">trending_up</span>
            전월 대비 +12.5%
          </span>
        </div>

        {/* Sub stats */}
        <div className="mt-8 grid grid-cols-2 gap-4">
          <div className="bg-surface-container-low p-4 rounded-xl">
            <div className="text-[10px] text-outline font-bold mb-1">지난달 금고 결산</div>
            <div className="text-lg font-bold tabular-nums text-primary">+₩1,250,000</div>
          </div>
          <div className="bg-surface-container-low p-4 rounded-xl">
            <div className="text-[10px] text-outline font-bold mb-1">가용 현금</div>
            <div className="text-lg font-bold tabular-nums">₩3,500,000</div>
          </div>
        </div>

        {/* Savings progress */}
        <div className="mt-6">
          <div className="flex justify-between items-end mb-2">
            <div className="text-[10px] text-outline font-bold">저축 목표: 새 iPhone (85%)</div>
            <div className="text-xs font-bold text-primary tabular-nums">₩1,275,000 / ₩1,500,000</div>
          </div>
          <div className="w-full bg-surface-container-high h-2.5 rounded-full overflow-hidden">
            <div className="bg-primary h-full rounded-full shadow-sm transition-all duration-700" style={{ width: '85%' }} />
          </div>
        </div>
      </div>

      {/* Dynamic Vault Drop Button */}
      <button
        onClick={openUpload}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="mt-8 relative z-10 w-full bg-gradient-to-r from-primary to-primary-dim text-white py-5 px-6 rounded-2xl font-bold shadow-lg shadow-primary/20 active:scale-[0.98] transition-shadow duration-300 hover:shadow-xl hover:shadow-primary/30 cursor-pointer"
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
