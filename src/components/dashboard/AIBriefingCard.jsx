import VaultSankeyCard from '../charts/VaultSankeyCard'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'

const goalCards = [
  {
    icon: 'flight',
    title: '올여름 가족 여행 예산',
    current: 1850000,
    target: 3000000,
    color: 'from-primary to-primary-container',
  },
  {
    icon: 'phone_iphone',
    title: '새 iPhone 구매',
    current: 1275000,
    target: 1500000,
    color: 'from-tertiary to-tertiary-fixed-dim',
  },
]

function percent(current, target) {
  return Math.min(100, Math.round((current / target) * 100))
}

export default function AIBriefingCard() {
  const transactions = useVaultStore((s) => s.transactions)
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const restoreTrinityMode = useUIStore((s) => s.restoreTrinityMode)

  return (
    <div className="bg-surface-container-lowest rounded-t-3xl rounded-b-2xl p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col h-[420px] overflow-hidden transition-all duration-500 ease-in-out">
      {!isChartMode ? (
        <>
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
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

          <div className="grid gap-4">
            {goalCards.map((goal) => {
              const pct = percent(goal.current, goal.target)
              return (
                <div key={goal.title} className="rounded-2xl bg-surface-container-low p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-10 h-10 rounded-xl bg-gradient-to-br ${goal.color} text-white flex items-center justify-center`}
                      >
                        <span className="material-symbols-outlined text-lg">{goal.icon}</span>
                      </div>
                      <div>
                        <div className="text-sm font-bold">{goal.title}</div>
                        <div className="text-[10px] text-outline">목표 달성률 {pct}%</div>
                      </div>
                    </div>
                    <div className="text-xs font-bold tabular-nums text-primary">
                      ₩{goal.current.toLocaleString('ko-KR')} / ₩{goal.target.toLocaleString('ko-KR')}
                    </div>
                  </div>

                  <div className="w-full h-2.5 rounded-full bg-surface-container-high overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}

            <div className="rounded-2xl bg-primary/[0.04] border border-primary/10 p-4">
              <p className="text-sm text-on-surface-variant leading-relaxed">
                오늘은 차트 대신 목표를 먼저 보여드렸어요.
                <span className="text-primary font-bold"> AI 비서에게 "데이터 시각화"를 요청</span>하면 중앙 스크린이
                확장되어 자금 흐름도를 열 수 있습니다.
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
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
