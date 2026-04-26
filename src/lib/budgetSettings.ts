const LS_KEY = 'vaulter.budget.monthlyTotalWon'

/**
 * 이번 달 **전체** 소비 예산(원). 0 = 미설정(사용자가 아직 한도를 안 박은 상태).
 * 로컬 localStorage only — 서버로 전송하지 않음.
 */
export function getMonthlyBudgetTotalWon(): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(LS_KEY)
  if (raw == null) return 0
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export function setMonthlyBudgetTotalWon(won: number): void {
  if (typeof localStorage === 'undefined') return
  const n = Math.floor(Number(won))
  if (!Number.isFinite(n) || n < 0) {
    localStorage.removeItem(LS_KEY)
    return
  }
  localStorage.setItem(LS_KEY, String(n))
}
