import { getMonthlyBudgetTotalWon } from './budgetSettings'
import { useVaultStore } from '../stores/vaultStore'
import { selectThisMonthConsumptiveExpenseTotal } from '../selectors/vaultSelectors'

/**
 * `/api/chat-assistant-budget` body.budgetContext — CFO가 원장·예산을 동시에 보도록.
 * 훅 밖(요청 직전)에서 `getState()`로 호출한다.
 */
export function buildBudgetContextPayload(): {
  monthlyLimit: number
  currentSpent: number
  remaining: number
  isOverBudget: boolean
  hasBudgetSet: boolean
  isBudgetDangerLow: boolean
  /** 한도의 몇 %가 남았는지 0~1, 한도 없으면 null */
  remainingRatio: number | null
} {
  const transactions = useVaultStore.getState().transactions
  const monthlyLimit = getMonthlyBudgetTotalWon()
  const currentSpent = selectThisMonthConsumptiveExpenseTotal(transactions)
  const remaining = monthlyLimit - currentSpent
  const hasBudgetSet = monthlyLimit > 0
  const isOverBudget = hasBudgetSet && currentSpent > monthlyLimit
  const remainingRatio =
    hasBudgetSet && !isOverBudget && remaining >= 0 ? remaining / monthlyLimit : null
  const isBudgetDangerLow =
    hasBudgetSet && !isOverBudget && remaining >= 0 && remainingRatio != null && remainingRatio < 0.1

  return {
    monthlyLimit,
    currentSpent,
    remaining,
    isOverBudget,
    hasBudgetSet,
    isBudgetDangerLow,
    remainingRatio,
  }
}
