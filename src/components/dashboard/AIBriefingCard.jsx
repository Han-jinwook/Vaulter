import { Link } from 'react-router-dom'
import VaultSankeyCard from '../charts/VaultSankeyCard'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'

// 목표(Goal) 관련 로직은 제거됨

export default function AIBriefingCard() {
  const transactions = useVaultStore((s) => s.transactions)
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const restoreTrinityMode = useUIStore((s) => s.restoreTrinityMode)
  const cardClass = isChartMode
    ? 'bg-surface-container-lowest rounded-t-3xl rounded-b-2xl px-6 md:px-7 pt-4 md:pt-5 pb-6 md:pb-7 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col h-[396px] overflow-hidden transition-all duration-500 ease-in-out'
    : 'bg-surface-container-lowest rounded-t-3xl rounded-b-2xl px-5 md:px-6 pt-3 md:pt-4 pb-4 md:pb-5 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col h-[320px] overflow-hidden transition-all duration-500 ease-in-out'

  return (
    <div className={cardClass}>
      {!isChartMode ? (
        <>
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-xl">auto_awesome</span>
              </div>
              <div>
                <h2 className="font-bold text-lg">나의 꿈과 목표</h2>
                <p className="text-[10px] text-outline font-medium">오늘도 한 걸음씩 쌓이는 금고 플랜</p>
              </div>
            </div>
            {/* 시각화 토글 버튼 — 우상단 */}
            <button
              onClick={openVizMode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-container-high text-on-surface hover:bg-surface-container-highest transition-colors active:scale-95 text-[11px] font-bold"
              title="데이터 시각화 열기"
            >
              <span className="material-symbols-outlined text-[14px]">radio_button_checked</span>
              데이터 시각화
            </button>
          </div>

          <div className="grid gap-2.5">
            <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-4 text-center">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <span className="material-symbols-outlined text-primary text-2xl">analytics</span>
              </div>
              <p className="text-sm font-bold text-on-surface">금고 요약 브리핑</p>
              <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
                현재 원장을 기반으로 자금 흐름을 시각화할 수 있습니다.<br />
                우측 상단 <strong>데이터 시각화</strong> 버튼을 누르거나 AI 비서에게 요청해보세요.
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <h2 className="font-bold text-lg">데이터 시각화</h2>
              <p className="text-[10px] text-outline font-medium">대화 맥락 기반 자금 흐름 분석</p>
            </div>
            <button
              onClick={restoreTrinityMode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors active:scale-95 text-[11px] font-bold"
              title="시각화 닫기"
            >
              <span className="material-symbols-outlined text-[14px]">radio_button_checked</span>
              시각화 닫기
            </button>
          </div>
          <VaultSankeyCard transactions={transactions} chartHeight={280} />
        </>
      )}
    </div>
  )
}
