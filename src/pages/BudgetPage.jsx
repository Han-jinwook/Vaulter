import { useState, useEffect, useCallback, useMemo } from 'react'
import { useVaultStore } from '../stores/vaultStore'
import { useUIStore } from '../stores/uiStore'
import { getMonthlyBudgetTotalWon, setMonthlyBudgetTotalWon } from '../lib/budgetSettings'
import {
  useAssetStats,
  useThisMonthConsumptiveByCategory,
  formatKRW,
} from '../selectors/vaultSelectors'

const alertOptions = ['한 달 전', '1주 전', '하루 전', '당일', '알림 끔']

/**
 * 서포터 표: 앱 전용 로컬 UI 샘플(원장과 무관). 추후 별도 스키마/저장으로 이전 예정.
 */
const initialSupportRows = []

function pctClamped(used, cap) {
  if (!Number.isFinite(cap) || cap <= 0) return 0
  return Math.min(100, (used / cap) * 100)
}

export default function BudgetPage() {
  const [rows, setRows] = useState(initialSupportRows)
  const [budgetWon, setBudgetWon] = useState(0)
  const [budgetInput, setBudgetInput] = useState('')

  const simulateEmailLanding = useVaultStore((s) => s.simulateEmailLanding)
  const openChatPanel = useUIStore((s) => s.openChatPanel)
  const budgetGoals = useVaultStore((s) => s.budgetGoals)

  const { thisMonthExpense, thisMonthOutflow, hasData, monthLabel } = useAssetStats()
  const byCategory = useThisMonthConsumptiveByCategory()

  const categoryRows = useMemo(() => {
    return [...byCategory.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
  }, [byCategory])

  useEffect(() => {
    const v = getMonthlyBudgetTotalWon()
    setBudgetWon(v)
    setBudgetInput(v > 0 ? String(v) : '')
  }, [])

  const applyBudget = useCallback(() => {
    const raw = String(budgetInput).replace(/[^\d]/g, '')
    const n = raw === '' ? 0 : Number.parseInt(raw, 10)
    const next = Number.isFinite(n) && n >= 0 ? n : 0
    setMonthlyBudgetTotalWon(next)
    setBudgetWon(next)
  }, [budgetInput])

  const monthlySpent = thisMonthExpense
  const hasCap = budgetWon > 0
  const overBudget = hasCap && monthlySpent > budgetWon
  const remain = hasCap ? Math.max(0, budgetWon - monthlySpent) : 0
  const barPct = hasCap ? pctClamped(monthlySpent, budgetWon) : 0
  const barClass = overBudget
    ? 'bg-error'
    : 'bg-primary'

  const setNotify = (id, notify) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, notify } : row)))
  }

  const runLandingSimulation = () => {
    openChatPanel()
    simulateEmailLanding()
  }

  return (
    <section className="space-y-6">
      <div className="bg-surface-container-lowest rounded-xl p-6 md:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
        <div>
          <p className="text-xs font-bold text-on-surface-variant tracking-widest uppercase">예산 & 목표</p>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">나의 꿈과 목표</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            아래 <strong>이번 달 소비 예산</strong>은 지기 원장(소비성 지출만)과 <strong>실시간</strong>으로 맞춰집니다. 카드
            상환·대출 납부는 예산에서 제외됩니다.
          </p>
        </div>

        {budgetGoals.length > 0 ? (
          <div className="mt-5 grid gap-3">
            {budgetGoals.map((goal) => {
              const target = Math.max(0, Number(goal.targetAmount) || 0)
              const current = Math.max(0, Number(goal.currentAmount) || 0)
              const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
              return (
                <div
                  key={goal.id}
                  className="rounded-2xl border border-outline-variant/15 bg-surface-container-low/50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{goal.title}</p>
                      <p className="text-[11px] text-on-surface-variant mt-0.5">
                        {goal.targetDate ? `목표일 ${goal.targetDate}` : '목표일 미지정'}
                      </p>
                    </div>
                    <div className="text-xs font-bold tabular-nums text-primary shrink-0">
                      ₩{current.toLocaleString('ko-KR')} / ₩{target.toLocaleString('ko-KR')}
                    </div>
                  </div>
                  <div className="mt-3 h-2.5 rounded-full bg-surface-container overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-outline-variant/15 bg-surface-container-low/50 p-6 text-sm text-on-surface-variant">
            <p>
              아직 저장된 목표가 없습니다. 예산·목표 CFO 채팅에서 목표를 등록하면 이 패널에 즉시 표시됩니다.
            </p>
          </div>
        )}
      </div>

      {/* 이번 달 소비 예산 — ledger_lines (소비성) 기준 */}
      <div
        className={`bg-surface-container-lowest rounded-xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] border ${
          overBudget ? 'border-error/50 ring-1 ring-error/20' : 'border-outline-variant/10'
        }`}
      >
        <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
          <div>
            <h2 className="text-lg font-bold">이번 달 소비 예산 (원장 연동)</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {monthLabel} · 소비성만 집계 (카드대금·대출 상환 제외)
            </p>
          </div>
          <div className="text-right text-sm font-bold tabular-nums">
            <span className="text-on-surface-variant mr-2">남은 한도</span>
            <span className={overBudget ? 'text-error' : 'text-primary'}>
              {hasCap ? `₩${remain.toLocaleString('ko-KR')}` : '—'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 mt-4 mb-3">
          <label className="text-xs font-bold text-on-surface-variant">월 소비 한도 (원, 로컬 저장)</label>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="예: 3200000"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={applyBudget}
              className="min-w-[160px] flex-1 sm:flex-none px-3 py-2 rounded-lg border border-outline-variant/20 text-sm bg-surface"
            />
            <button
              type="button"
              onClick={applyBudget}
              className="px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-sm font-bold"
            >
              적용
            </button>
          </div>
        </div>

        <div className="w-full h-3 rounded-full bg-surface-container-low overflow-hidden">
          {hasCap ? (
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass}`}
              style={{ width: `${barPct}%` }}
            />
          ) : (
            <div className="h-full w-0" />
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
          <span>
            소비 누적:{' '}
            <strong className="text-on-surface tabular-nums">₩{monthlySpent.toLocaleString('ko-KR')}</strong>
            {hasData ? '' : ' (원장이 비어 있으면 0)'}
          </span>
          {hasCap && (
            <span>
              한도: <strong className="tabular-nums">₩{budgetWon.toLocaleString('ko-KR')}</strong>
            </span>
          )}
        </div>

        {overBudget && (
          <p className="mt-3 text-sm font-bold text-error">
            한도를 ₩{(monthlySpent - budgetWon).toLocaleString('ko-KR')} 초과했습니다. 통장에 남은 돈과 무관하게, 이번 달
            &apos;쓰기로 한&apos; 액을 넘겼어요.
          </p>
        )}

        {!hasCap && (
          <p className="mt-2 text-xs text-on-surface-variant">
            위에 월 한도를 입력·적용하면, 지기에서 기록한 <strong>소비성</strong> 지출이 차감된 막대가 표시됩니다.
          </p>
        )}

        {hasData && thisMonthOutflow > monthlySpent && (
          <p className="mt-2 text-[11px] text-on-surface-variant/80">
            참고: 이번 달 전체 출금(상환·이자 등 포함)은 약 {formatKRW(thisMonthOutflow)} — 예산 막대에는
            <strong> 소비</strong>만 반영됩니다.
          </p>
        )}
      </div>

      {categoryRows.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <h2 className="text-lg font-bold mb-1">이번 달 소비 (카테고리별, 원장)</h2>
          <p className="text-xs text-on-surface-variant mb-3">같은 달·소비성만 합산. 정렬: 금액 내림차순.</p>
          <ul className="space-y-2">
            {categoryRows.map(([cat, won]) => (
              <li
                key={cat}
                className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/10 px-3 py-2.5 bg-surface/80"
              >
                <span className="text-sm font-semibold text-on-surface">{cat}</span>
                <span className="text-sm font-bold tabular-nums text-secondary">₩{won.toLocaleString('ko-KR')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl p-6 md:p-8 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <p className="text-xs font-bold text-on-surface-variant tracking-widest uppercase">서포터 영역</p>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">고정 지출 및 알림 통제실</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              아래 표는 <strong>샘플 UI</strong>이며 아직 원장과 연동되지 않습니다. (추후 스키마 확정)
            </p>
          </div>
          <button
            onClick={runLandingSimulation}
            className="px-4 py-2 rounded-full bg-primary text-white text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all active:scale-95"
          >
            🔔 이메일 랜딩 시뮬레이션
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-4">등록된 항목이 없습니다. (고정지출·알림 — 추후 연동)</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-surface-container">
            <table className="w-full border-collapse">
              <thead className="bg-surface-container-low/50">
                <tr>
                  <th className="px-5 py-3 text-left text-[10px] uppercase tracking-wider text-outline font-bold">항목명</th>
                  <th className="px-5 py-3 text-left text-[10px] uppercase tracking-wider text-outline font-bold">유형</th>
                  <th className="px-5 py-3 text-right text-[10px] uppercase tracking-wider text-outline font-bold">예상 금액</th>
                  <th className="px-5 py-3 text-left text-[10px] uppercase tracking-wider text-outline font-bold">알림 설정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-surface-container hover:bg-surface-container-low/40 transition-colors"
                  >
                    <td className="px-5 py-4">
                      <div className="font-semibold text-on-surface">{row.name}</div>
                    </td>
                    <td className="px-5 py-4">
                      {row.kind === 'regular' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-primary/10 text-primary">
                          정기성(매월)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-tertiary-container/30 text-on-tertiary-container">
                          일회성
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-bold tabular-nums">₩{row.amount.toLocaleString('ko-KR')}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {alertOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setNotify(row.id, opt)}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              row.notify === opt
                                ? 'bg-primary/12 text-primary border-primary/25'
                                : 'bg-white text-on-surface-variant border-surface-container hover:border-primary/20'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
