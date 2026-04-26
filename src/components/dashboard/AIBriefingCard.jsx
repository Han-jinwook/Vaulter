import { Link } from 'react-router-dom'
import VaultSankeyCard from '../charts/VaultSankeyCard'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'

/**
 * 저장소에 연동된 목표가 생기면 여기서 표시한다. (현재 스키마/스토어 미연동 — 데모 숫자 금지)
 * @type {{ icon: string, title: string, current: number, target: number, color: string }[]}
 */
function getSavedGoalsForDashboard() {
  return []
}

function percent(current, target) {
  if (!Number.isFinite(target) || target <= 0) return 0
  return Math.min(100, Math.round((current / target) * 100))
}

export default function AIBriefingCard() {
  const transactions = useVaultStore((s) => s.transactions)
  const isChartMode = useUIStore((s) => s.isChartMode)
  const openVizMode = useUIStore((s) => s.openVizMode)
  const restoreTrinityMode = useUIStore((s) => s.restoreTrinityMode)
  const goalCards = getSavedGoalsForDashboard()

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
            {goalCards.length > 0 ? (
              goalCards.map((goal) => {
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
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-low/40 p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <span className="material-symbols-outlined text-primary text-2xl">flag</span>
                </div>
                <p className="text-sm font-bold text-on-surface">저장된 목표가 없습니다</p>
                <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
                  이전에 보이던 금액·진행률은 <strong>UI 샘플(데모)</strong>이며 실제 데이터가 아닙니다.{' '}
                  <strong>월 소비 한도</strong>는 <strong>예산&amp;목표</strong> 탭에서 설정하세요. 목표 저축
                  진행률은 저장소 연동 전이라 아직 이 패널에 나오지 않습니다.
                </p>
                <Link
                  to="/budget"
                  className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 active:scale-[0.99]"
                >
                  예산 &amp; 목표 열기
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </Link>
              </div>
            )}

            <div className="rounded-2xl bg-primary/[0.04] border border-primary/10 p-4">
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {goalCards.length > 0 ? (
                  <>
                    <span className="text-primary font-bold"> AI 비서에게 &quot;데이터 시각화&quot;를 요청</span>하면
                    중앙 스크린이 확장되어 자금 흐름도를 열 수 있습니다.
                  </>
                ) : (
                  <>
                    지금은 원장 기반 <strong>자금 흐름</strong>을 먼저 쌓아 보세요.{' '}
                    <span className="text-primary font-bold">「데이터 시각화」</span>로 샌키 차트를 열 수 있습니다.
                  </>
                )}
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
