const DEBT_CATEGORIES = new Set(['대출', '할부', '카드대금', '부채상환'])
const TRANSFER_CATEGORIES = new Set(['이체'])
const SAVING_CATEGORIES = new Set(['저축', '투자'])

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function dateKeyFromTx(tx) {
  if (tx?.occurredAt) return String(tx.occurredAt).slice(0, 10)
  if (typeof tx?.date === 'string') return tx.date.replaceAll('.', '-')
  return new Date().toISOString().slice(0, 10)
}

function txDate(tx) {
  if (tx?.occurredAt) {
    const d = new Date(tx.occurredAt)
    if (!Number.isNaN(d.getTime())) return d
  }
  if (typeof tx?.date === 'string') {
    const normalized = tx.date.replaceAll('.', '-')
    const d = new Date(normalized)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function latestAnchorDate(transactions = []) {
  const parsed = transactions.map(txDate).filter(Boolean)
  if (!parsed.length) return new Date()
  return new Date(Math.max(...parsed.map((d) => d.getTime())))
}

function isInPeriod(tx, period, anchor) {
  const d = txDate(tx)
  if (!d) return false

  if (period === 'last_7d') {
    const start = new Date(anchor)
    start.setDate(anchor.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    return d >= start && d <= anchor
  }

  if (period === 'this_month') {
    return d.getFullYear() === anchor.getFullYear() && d.getMonth() === anchor.getMonth()
  }

  return true
}

function isConfirmed(tx, confirmedOnly) {
  return confirmedOnly ? tx?.status === 'CONFIRMED' : true
}

function isDebt(tx) {
  return tx?.accountType === 'loan' || DEBT_CATEGORIES.has(tx?.categoryMain || tx?.category || '')
}

function isTransfer(tx) {
  return tx?.direction === 'transfer' || tx?.isInternalTransfer || TRANSFER_CATEGORIES.has(tx?.categoryMain || tx?.category || '')
}

export function selectDataConfidence(transactions = []) {
  if (!transactions.length) return 0
  const confirmed = transactions.filter((t) => t.status === 'CONFIRMED').length
  return confirmed / transactions.length
}

export function selectWealthSnapshot(transactions = [], options = {}) {
  const { confirmedOnly = true } = options
  const rows = transactions.filter((t) => isConfirmed(t, confirmedOnly))

  let totalAssets = 0
  let totalLiabilities = 0
  let monthlyCashflow = 0

  for (const tx of rows) {
    const amount = toNumber(tx.amount)
    if (amount > 0) {
      totalAssets += amount
      monthlyCashflow += amount
      continue
    }
    if (isDebt(tx)) {
      totalLiabilities += Math.abs(amount)
    } else if (!isTransfer(tx)) {
      monthlyCashflow += amount
    }
  }

  const netWorth = totalAssets - totalLiabilities
  const availableCash = Math.max(totalAssets + monthlyCashflow, 0)

  return {
    asOf: new Date().toISOString().slice(0, 10),
    totalAssets,
    totalLiabilities,
    netWorth,
    availableCash,
    monthlyCashflow,
    dataConfidence: selectDataConfidence(transactions),
  }
}

export function selectSankeyModel(transactions = [], options = {}) {
  const { confirmedOnly = true, period = 'this_month' } = options
  const anchor = latestAnchorDate(transactions)
  const rows = transactions
    .filter((t) => isConfirmed(t, confirmedOnly))
    .filter((t) => isInPeriod(t, period, anchor))

  let totalIncome = 0
  let debtOut = 0
  let savingOut = 0
  const expenseByCategory = new Map()

  for (const tx of rows) {
    const amount = toNumber(tx.amount)
    if (amount > 0) {
      totalIncome += amount
      continue
    }
    if (isTransfer(tx)) continue
    const key = tx.categoryMain || tx.category || '기타'
    const abs = Math.abs(amount)
    if (isDebt(tx)) {
      debtOut += abs
      continue
    }
    if (SAVING_CATEGORIES.has(key)) {
      savingOut += abs
      continue
    }
    expenseByCategory.set(key, (expenseByCategory.get(key) || 0) + abs)
  }

  const nodes = [
    { id: 'income', name: '수입', group: 'income' },
    { id: 'pool', name: '가용현금', group: 'pool' },
  ]
  const links = []

  if (totalIncome > 0) {
    links.push({ source: 'income', target: 'pool', value: totalIncome })
  }

  const sortedExpenses = [...expenseByCategory.entries()].sort((a, b) => b[1] - a[1])
  const top = sortedExpenses.slice(0, 5)
  const rest = sortedExpenses.slice(5).reduce((sum, [, value]) => sum + value, 0)

  for (const [category, value] of top) {
    const nodeId = `expense:${category}`
    nodes.push({ id: nodeId, name: category, group: 'expense' })
    links.push({
      source: 'pool',
      target: nodeId,
      value,
      meta: { ratio: totalIncome > 0 ? value / totalIncome : 0 },
    })
  }

  if (rest > 0) {
    nodes.push({ id: 'expense:기타', name: '기타', group: 'expense' })
    links.push({
      source: 'pool',
      target: 'expense:기타',
      value: rest,
      meta: { ratio: totalIncome > 0 ? rest / totalIncome : 0 },
    })
  }

  if (debtOut > 0) {
    nodes.push({ id: 'debt', name: '부채상환', group: 'debt' })
    links.push({
      source: 'pool',
      target: 'debt',
      value: debtOut,
      meta: { ratio: totalIncome > 0 ? debtOut / totalIncome : 0 },
    })
  }

  if (savingOut > 0) {
    nodes.push({ id: 'saving', name: '저축·투자', group: 'saving' })
    links.push({
      source: 'pool',
      target: 'saving',
      value: savingOut,
      meta: { ratio: totalIncome > 0 ? savingOut / totalIncome : 0 },
    })
  }

  const periodLabel = period === 'last_7d' ? '최근 7일' : period === 'this_month' ? '이번 달' : '전체'
  return {
    nodes,
    links,
    asOf: rows[0] ? dateKeyFromTx(rows[0]) : new Date().toISOString().slice(0, 10),
    periodLabel,
  }
}

// ─── AssetCard 전용 집계 hook ────────────────────────────────────────────────

import { useMemo } from 'react'
import { useVaultStore } from '../stores/vaultStore'

function parseTransactionDate(dateStr) {
  const m = String(dateStr || '').match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * 지기 원장 누적 가용(수입 − 지출, TRANSFER 제외). useAssetStats·자산 AI System Info에서 공통 사용.
 */
export function selectLedgerCumulativeBalance(transactions = []) {
  let totalIncome = 0
  let totalExpense = 0
  for (const tx of transactions) {
    if (tx.type === 'TRANSFER') continue
    const d = parseTransactionDate(tx.date)
    if (!d) continue
    const amt = Number(tx.amount) || 0
    if (tx.type === 'INCOME') totalIncome += amt
    else if (tx.type === 'EXPENSE') totalExpense += Math.abs(amt)
  }
  return totalIncome - totalExpense
}

/**
 * 4개 재무 지표 집계 hook (AssetCard 전용)
 * - cumulativeBalance: 전체 수입 - 전체 지출 (누적 가용 자금)
 * - thisMonthFlow:     이번 달 수입 - 이번 달 지출
 * - thisMonthExpense:  이번 달 지출 총액
 * - expenseChangeRate: (이번 달 지출 - 지난달 지출) / 지난달 지출 * 100 (null = 지난달 없음)
 * TRANSFER 타입은 모든 집계에서 제외.
 */
export function useAssetStats() {
  const transactions = useVaultStore((s) => s.transactions)

  return useMemo(() => {
    const now = new Date()
    const thisYear = now.getFullYear()
    const thisMonth = now.getMonth()
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1

    let thisMonthIncome = 0
    let thisMonthExpense = 0
    let lastMonthExpense = 0

    for (const tx of transactions) {
      if (tx.type === 'TRANSFER') continue
      const d = parseTransactionDate(tx.date)
      if (!d) continue
      const amt = Number(tx.amount) || 0

      if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) {
        if (tx.type === 'INCOME') thisMonthIncome += amt
        else if (tx.type === 'EXPENSE') thisMonthExpense += Math.abs(amt)
      }
      if (d.getFullYear() === lastMonthYear && d.getMonth() === lastMonth) {
        if (tx.type === 'EXPENSE') lastMonthExpense += Math.abs(amt)
      }
    }

    return {
      hasData: transactions.length > 0,
      cumulativeBalance: selectLedgerCumulativeBalance(transactions),
      thisMonthFlow: thisMonthIncome - thisMonthExpense,
      thisMonthIncome,
      thisMonthExpense,
      expenseChangeRate:
        lastMonthExpense > 0
          ? ((thisMonthExpense - lastMonthExpense) / lastMonthExpense) * 100
          : null,
    }
  }, [transactions])
}

/** 원화 포맷. 예: ₩1,234,567 */
export function formatKRW(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '—'
  return `₩${Math.abs(amount).toLocaleString('ko-KR')}`
}

/** "2026년 4월 기준" 형태 현재 날짜 레이블 */
export function getCurrentMonthLabel() {
  const now = new Date()
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 기준`
}
