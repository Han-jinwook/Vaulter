import { create } from 'zustand'
import type { Transaction } from '../types/schema'
import {
  analyzeDocumentWithGPT,
  type DocumentParseResult,
} from '../lib/visionAIEngine'
import {
  drainBackgroundPendingQueue,
  type BackgroundParsedItem,
} from '../lib/gmailSync'

function timeNow() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function todayDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

let _id = 100

type ChatRole = 'ai' | 'user'
type ChatType = 'text' | 'confirm' | 'account_confirm' | 'processing' | 'result' | 'alert' | 'ledger_review'

type ConfirmOption = {
  label: string
  category: string
}

export type ChatMessage = {
  id: number
  role: ChatRole
  type: ChatType
  text: string
  time: string
  resolved?: boolean
  txId?: number
  ledgerTxId?: number
  options?: ConfirmOption[] | string[]
  accountOptions?: ConfirmOption[]
  subtitle?: string
  credit?: string
}

type LedgerDecision = {
  ledgerTxId: number
  category: string
}

export type VaultTransaction = Transaction & {
  id: string
  createdAt: string
  source: 'upload' | 'gmail' | 'manual'
  sourceRef?: string
  name: string
  location: string
  userMemo: string
  icon: string
  iconBg: string
  iconColor: string
}

type LedgerFilter = 'all' | 'review' | 'income' | 'expense'
type IngestBackgroundResult = {
  insertedCount: number
  insertedSourceRefs: string[]
  skippedDuplicateSourceRefs: string[]
}

type IngestDocumentBatchResult = {
  insertedCount: number
  insertedTxIds: string[]
}

export type VaultBackupSnapshot = {
  version: number
  exportedAt: string
  transactions: VaultTransaction[]
  messages: ChatMessage[]
  knownAccounts: string[]
  lastLedgerDecision: LedgerDecision | null
  ledgerContextTitle: string
  activeLedgerFilter: LedgerFilter
  reviewPinnedTxIds: string[]
}

type VaultState = {
  transactions: VaultTransaction[]
  messages: ChatMessage[]
  knownAccounts: string[]
  lastLedgerDecision: LedgerDecision | null
  ledgerContextTitle: string
  activeLedgerFilter: LedgerFilter
  reviewPinnedTxIds: string[]
  hoveredTxId: string | null
  isDragging: boolean
  isProcessing: boolean

  setLedgerContextByFilter: (filter: LedgerFilter) => void
  setLedgerAiReviewContext: () => void
  setHoveredTx: (id: string | null) => void
  setDragging: (v: boolean) => void
  simulateEmailLanding: () => void
  acknowledgeAlert: (messageId: number, label: string) => void
  askAboutTransaction: (txId: string) => void
  askLedgerReview: (tx: VaultTransaction) => void
  resolveLedgerReview: (messageId: number, ledgerTxId: number, category: string) => void
  clearLedgerDecision: () => void
  confirmTransaction: (txId: string, category: string) => void
  confirmTransactionAccount: (txId: string, account: string) => void
  completeTransactionReview: (txId: string, category: string, account: string) => void
  updateTransactionInline: (
    txId: string,
    patch: Partial<Pick<VaultTransaction, 'name' | 'location' | 'userMemo' | 'category' | 'amount' | 'account'>>
  ) => void
  ingestBackgroundParsedEntries: (items: BackgroundParsedItem[]) => IngestBackgroundResult
  ingestDocumentAnalysisBatch: (
    documentId: string,
    sourceLabel: string,
    items: DocumentParseResult[]
  ) => IngestDocumentBatchResult
  exportBackupSnapshot: () => VaultBackupSnapshot
  restoreFromBackupSnapshot: (snapshot: VaultBackupSnapshot) => void
  syncPendingFromBackgroundQueue: () => Promise<number>
  processDroppedFiles: () => Promise<void>
  analyzeDocumentWithVision: (documentId: string, file: File, fileType: string) => Promise<string>
}

function normalizeApiDate(dateText?: string | null) {
  if (!dateText) return todayDate()
  const m = String(dateText).match(/(\d{4})[-./](\d{2})[-./](\d{2})/)
  if (!m) {
    const parsed = new Date(String(dateText))
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear()
      const mm = String(parsed.getMonth() + 1).padStart(2, '0')
      const dd = String(parsed.getDate()).padStart(2, '0')
      return `${y}.${mm}.${dd}`
    }
    return todayDate()
  }
  return `${m[1]}.${m[2]}.${m[3]}`
}

function normalizeCategoryLabel(category?: string, merchant?: string) {
  const raw = String(category || '').trim()
  const merchantText = String(merchant || '').toLowerCase()
  const key = raw.toLowerCase()
  const dict: Record<string, string> = {
    subscription: '구독',
    subscriptions: '구독',
    media: '미디어',
    entertainment: '미디어',
    cloud: '클라우드',
    'cloud services': '클라우드',
    service: '서비스',
    services: '서비스',
    shopping: '쇼핑',
    food: '식비',
    transport: '교통',
    utility: '공과금',
    utilities: '공과금',
    tax: '세금',
    income: '수입',
    refund: '환급',
    transfer: '이체',
    others: '기타',
    other: '기타',
  }

  if (dict[key]) return dict[key]
  if (merchantText.includes('netflix') || merchantText.includes('youtube')) return '미디어'
  if (merchantText.includes('openai') || merchantText.includes('google cloud')) return '클라우드'
  if (merchantText.includes('coupang') || merchantText.includes('11st') || merchantText.includes('gmarket')) return '쇼핑'
  return raw || '기타'
}

function buildConfirmOptionsForTx(tx: VaultTransaction): ConfirmOption[] {
  if (tx.amount > 0) {
    return [
      { label: '수입', category: '수입' },
      { label: '환급', category: '환급' },
      { label: '기타', category: '기타' },
      { label: '직접입력…', category: '__CUSTOM__' },
    ]
  }
  return [
    { label: '구독', category: '구독' },
    { label: '서비스', category: '서비스' },
    { label: '쇼핑', category: '쇼핑' },
    { label: '직접입력…', category: '__CUSTOM__' },
  ]
}

function buildAccountOptions(knownAccounts: string[]): ConfirmOption[] {
  const unique = Array.from(new Set(knownAccounts.map((x) => String(x || '').trim()).filter(Boolean)))
  if (!unique.length) {
    return []
  }
  return [
    ...unique.slice(0, 3).map((account) => ({ label: account, category: account })),
  ]
}

function buildDocumentSummaryText(sourceLabel: string, insertedCount: number, reviewCount: number) {
  if (reviewCount > 0) {
    return `"${sourceLabel}"에서 ${insertedCount}건을 검토 대기 상태로 반영했어요. 우선 ${reviewCount}건만 빠르게 확인해 주세요.`
  }
  return `"${sourceLabel}"에서 ${insertedCount}건을 검토 대기 상태로 반영했어요.`
}

function computeNextInternalId(transactions: VaultTransaction[], messages: ChatMessage[]) {
  const txMax = transactions.reduce((max, tx) => Math.max(max, Number(tx.id) || 0), 0)
  const msgMax = messages.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0)
  return Math.max(100, txMax, msgMax)
}

function buildPendingTxFromParsed(input: {
  merchant?: string
  date?: string | null
  amount?: number
  category?: string
  reasoning?: string
  confidence?: number
  linkedDocumentId?: string | null
  source?: VaultTransaction['source']
  sourceRef?: string
  location?: string
  account?: string
}): VaultTransaction {
  const merchant = String(input.merchant || '가맹점 미확인').trim() || '가맹점 미확인'
  const normalizedCategory = normalizeCategoryLabel(input.category, merchant)
  const type: Transaction['type'] =
    /수입|환급|입금/.test(normalizedCategory) ? 'INCOME' : 'EXPENSE'
  const amountAbs = Math.abs(Number(input.amount || 0))
  const signedAmount = type === 'INCOME' ? amountAbs : -amountAbs
  const isTax = /세금|국세청|공과금/.test(`${normalizedCategory} ${merchant}`)

  return {
    id: String(++_id),
    createdAt: new Date().toISOString(),
    source: input.source || 'upload',
    sourceRef: input.sourceRef,
    date: normalizeApiDate(input.date),
    merchant,
    account: String(input.account || '').trim(),
    name: merchant,
    location: input.location || '',
    userMemo: String(input.reasoning || '').trim() || `${normalizedCategory} 자동 분류`,
    category: normalizedCategory,
    type,
    aiConfidence: Math.max(0, Math.min(1, Number(input.confidence || 0.9))),
    status: 'PENDING',
    isInternal: false,
    linkedDocumentId: input.linkedDocumentId || null,
    icon: isTax ? 'account_balance' : 'receipt_long',
    iconBg: isTax ? '#ffe8c2' : '#ffd3dc',
    iconColor: isTax ? '#875100' : '#7d2438',
    amount: signedAmount || -1,
  }
}

const initialTransactions: VaultTransaction[] = [
  {
    id: '1',
    createdAt: '2026-04-05T09:10:00.000Z',
    source: 'manual',
    date: '2026.04.05',
    merchant: '고메 버거 키친',
    name: '고메 버거 키친',
    location: '서울, KR',
    userMemo: '',
    category: '식비',
    type: 'EXPENSE',
    aiConfidence: 0.96,
    status: 'CONFIRMED',
    isInternal: false,
    linkedDocumentId: null,
    icon: 'restaurant',
    iconBg: '#ffc2c7',
    iconColor: '#891a33',
    amount: -18500,
  },
  {
    id: '2',
    createdAt: '2026-04-04T09:10:00.000Z',
    source: 'manual',
    date: '2026.04.04',
    merchant: '급여 입금',
    name: '급여 입금',
    location: 'Vaulter Corp',
    userMemo: '',
    category: '수입',
    type: 'INCOME',
    aiConfidence: 0.99,
    status: 'CONFIRMED',
    isInternal: false,
    linkedDocumentId: null,
    icon: 'payments',
    iconBg: '#6e9fff',
    iconColor: '#002150',
    amount: 3200000,
  },
  {
    id: '3',
    createdAt: '2026-04-04T09:40:00.000Z',
    source: 'manual',
    date: '2026.04.04',
    merchant: '카카오페이 송금',
    name: '카카오페이 송금',
    location: '김민수',
    userMemo: '',
    category: '',
    type: 'TRANSFER',
    aiConfidence: 0.53,
    status: 'PENDING',
    isInternal: false,
    linkedDocumentId: null,
    icon: 'currency_exchange',
    iconBg: '#fcdf46',
    iconColor: '#5d5000',
    amount: -50000,
  },
  {
    id: '4',
    createdAt: '2026-04-03T09:10:00.000Z',
    source: 'manual',
    date: '2026.04.03',
    merchant: '스팀 상점',
    name: '스팀 상점',
    location: '온라인 결제',
    userMemo: '',
    category: '게임',
    type: 'EXPENSE',
    aiConfidence: 0.95,
    status: 'CONFIRMED',
    isInternal: false,
    linkedDocumentId: null,
    icon: 'videogame_asset',
    iconBg: '#fcdf46',
    iconColor: '#5d5000',
    amount: -65000,
  },
  {
    id: '5',
    createdAt: '2026-04-02T09:10:00.000Z',
    source: 'manual',
    date: '2026.04.02',
    merchant: 'Netflix 구독',
    name: 'Netflix 구독',
    location: '자동결제',
    userMemo: '',
    category: '미디어',
    type: 'EXPENSE',
    aiConfidence: 0.91,
    status: 'CONFIRMED',
    isInternal: false,
    linkedDocumentId: null,
    icon: 'subscriptions',
    iconBg: '#e5e9eb',
    iconColor: '#595c5e',
    amount: -17000,
  },
]

const initialMessages: ChatMessage[] = [
  {
    id: 1,
    role: 'ai',
    type: 'text',
    text: '안녕하세요! 금고지기 AI입니다. 이번 달 지출 내역을 분석해 보았어요. 공과금 관리를 아주 효율적으로 잘하고 계시네요!',
    time: '오전 10:30',
  },
  {
    id: 2,
    role: 'ai',
    type: 'confirm',
    text: '4월 4일 "카카오페이 송금" ₩50,000 내역이 있네요. 이 송금은 어떤 분류인가요?',
    txId: 3,
    options: [
      { label: '축의금', category: '경조사' },
      { label: '더치페이', category: '식비' },
      { label: '개인 송금', category: '이체' },
    ],
    time: '오전 10:30',
  },
]

export const useVaultStore = create<VaultState>((set, get) => ({
  transactions: initialTransactions,
  messages: initialMessages,
  knownAccounts: [],
  lastLedgerDecision: null,
  ledgerContextTitle: '데이터 원장 (전체)',
  activeLedgerFilter: 'all',
  reviewPinnedTxIds: [],
  hoveredTxId: null,
  isDragging: false,
  isProcessing: false,

  setLedgerContextByFilter: (filter) => {
    const titleMap: Record<LedgerFilter, string> = {
      all: '데이터 원장 (전체)',
      income: '이번 달 수입 내역',
      expense: '이번 달 지출 내역',
      review: '미분류/검토 대기 내역',
    }
    set({
      activeLedgerFilter: filter,
      ledgerContextTitle: titleMap[filter],
      reviewPinnedTxIds: filter === 'review' ? get().reviewPinnedTxIds : [],
    })
  },

  setLedgerAiReviewContext: () => {
    set({ activeLedgerFilter: 'review', ledgerContextTitle: '🚨 AI와 함께 집중 검토 중' })
  },

  setHoveredTx: (id) => set({ hoveredTxId: id }),
  setDragging: (v) => set({ isDragging: v }),

  simulateEmailLanding: () => {
    const unresolved = get().messages.find((m) => m.type === 'alert' && !m.resolved)
    if (unresolved) return
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: ++_id,
          role: 'ai',
          type: 'alert',
          text: '멀린님, 내일 아파트 관리비 25만 원 납부일입니다. 이체 후 영수증은 금고에 던져주세요! ✨',
          options: ['롸져!', '확인'],
          time: timeNow(),
        },
      ],
    }))
  },

  acknowledgeAlert: (messageId, label) => {
    const target = get().messages.find((m) => m.id === messageId)
    if (!target || target.resolved) return
    set((s) => ({
      messages: [
        ...s.messages.map((m) =>
          m.id === messageId ? { ...m, resolved: true } : m
        ),
        { id: ++_id, role: 'user', type: 'text', text: label, time: timeNow() },
      ],
    }))
  },

  askAboutTransaction: (txId) => {
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx || tx.status !== 'PENDING') return
    const alreadyAsked = get().messages.some((m) => m.type === 'confirm' && m.txId === Number(txId) && !m.resolved)
    if (alreadyAsked) return

    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: ++_id,
          role: 'ai',
          type: 'confirm',
          text: `${tx.date} "${tx.name}" ₩${Math.abs(tx.amount).toLocaleString()} 내역이 있네요. 이 송금은 어떤 분류인가요?`,
          txId: Number(txId),
          options: [
            { label: '축의금', category: '경조사' },
            { label: '더치페이', category: '식비' },
            { label: '개인 송금', category: '이체' },
            { label: '직접입력…', category: '__CUSTOM__' },
          ],
          time: timeNow(),
        },
      ],
    }))
  },

  askLedgerReview: (tx) => {
    if (!tx) return
    const txNumId = Number(tx.id)
    const alreadyAsked = get().messages.some(
      (m) => m.type === 'ledger_review' && m.ledgerTxId === txNumId && !m.resolved
    )
    if (alreadyAsked) return

    const optionsByType =
      tx.amount > 0
        ? [
            { label: '수입', category: '수입' },
            { label: '환급', category: '환급' },
            { label: '기타', category: '기타' },
          ]
        : [
            { label: '식비', category: '식비' },
            { label: '데이트', category: '데이트' },
            { label: '기타', category: '기타' },
          ]

    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: ++_id,
          role: 'ai',
          type: 'ledger_review',
          ledgerTxId: txNumId,
          text: `멀린님, ${tx.date} '${tx.name}' ${Math.abs(tx.amount).toLocaleString('ko-KR')}원 내역은 어떤 카테고리로 볼까요?`,
          options: optionsByType,
          time: timeNow(),
        },
      ],
    }))
  },

  resolveLedgerReview: (messageId, ledgerTxId, category) => {
    const target = get().messages.find((m) => m.id === messageId)
    if (!target || target.resolved) return

    set((s) => ({
      lastLedgerDecision: { ledgerTxId, category },
      messages: [
        ...s.messages.map((m) =>
          m.id === messageId ? { ...m, resolved: true } : m
        ),
      ],
    }))
  },

  clearLedgerDecision: () => set({ lastLedgerDecision: null }),

  confirmTransaction: (txId, category) => {
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx || tx.status === 'CONFIRMED') return
    const nextCategory = String(category || '').trim()
    if (!nextCategory) return

    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, status: 'CONFIRMED', category: nextCategory } : t
      ),
      reviewPinnedTxIds: s.reviewPinnedTxIds.includes(txId)
        ? s.reviewPinnedTxIds
        : [txId, ...s.reviewPinnedTxIds],
      messages: [
        ...s.messages.map((m) =>
          m.type === 'confirm' && m.txId === Number(txId) ? { ...m, resolved: true } : m
        ),
      ],
    }))
  },

  confirmTransactionAccount: (txId, account) => {
    const nextAccount = String(account || '').trim()
    if (!nextAccount) return
    set((s) => ({
      knownAccounts: Array.from(new Set([nextAccount, ...s.knownAccounts])),
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, account: nextAccount } : t
      ),
      messages: [
        ...s.messages.map((m) =>
          m.type === 'account_confirm' && m.txId === Number(txId) ? { ...m, resolved: true } : m
        ),
      ],
    }))
  },

  completeTransactionReview: (txId, category, account) => {
    const nextCategory = String(category || '').trim()
    const nextAccount = String(account || '').trim()
    if (!nextCategory || !nextAccount) return
    set((s) => ({
      knownAccounts: Array.from(new Set([nextAccount, ...s.knownAccounts])),
      transactions: s.transactions.map((t) =>
        t.id === txId
          ? {
              ...t,
              status: 'CONFIRMED',
              category: nextCategory,
              account: nextAccount,
            }
          : t
      ),
      reviewPinnedTxIds: s.reviewPinnedTxIds.includes(txId)
        ? s.reviewPinnedTxIds
        : [txId, ...s.reviewPinnedTxIds],
      messages: s.messages.map((m) =>
        (m.type === 'confirm' || m.type === 'account_confirm') && m.txId === Number(txId)
          ? { ...m, resolved: true }
          : m
      ),
    }))
  },

  updateTransactionInline: (txId, patch) => {
    set((s) => ({
      knownAccounts:
        patch.account && String(patch.account).trim()
          ? Array.from(new Set([String(patch.account).trim(), ...s.knownAccounts]))
          : s.knownAccounts,
      transactions: s.transactions.map((t) => {
        if (t.id !== txId) return t
        const next = { ...t, ...patch }
        if (patch.name !== undefined) {
          next.merchant = patch.name
        }
        return next
      }),
    }))
  },

  ingestBackgroundParsedEntries: (items) => {
    if (!items.length) {
      return {
        insertedCount: 0,
        insertedSourceRefs: [],
        skippedDuplicateSourceRefs: [],
      }
    }
    const current = get().transactions
    const knownRefs = new Set(current.map((tx) => tx.sourceRef).filter(Boolean))
    const fresh = items.filter((item) => item.sourceMessageId && !knownRefs.has(item.sourceMessageId))
    const skippedDuplicateSourceRefs = items
      .filter((item) => item.sourceMessageId && knownRefs.has(item.sourceMessageId))
      .map((item) => item.sourceMessageId)
    console.info('[GmailDebug][Store] incoming:', items.length, 'knownRefs:', knownRefs.size, 'fresh:', fresh.length)
    if (!fresh.length) {
      return {
        insertedCount: 0,
        insertedSourceRefs: [],
        skippedDuplicateSourceRefs,
      }
    }

    const nextTxs = fresh.map((item) =>
      buildPendingTxFromParsed({
        merchant: item.merchant,
        date: item.date,
        amount: item.amount,
        category: item.category,
        reasoning: item.reasoning,
        confidence: item.confidence,
        source: 'gmail',
        sourceRef: item.sourceMessageId,
        location: 'Gmail 자동 수집',
      })
    )
    const knownAccounts = get().knownAccounts
    const reviewTargets = nextTxs.slice(0, 3)

    set((s) => ({
      transactions: [...nextTxs, ...s.transactions],
      messages: [
        ...s.messages,
        ...reviewTargets.map((tx) => ({
          id: ++_id,
          role: 'ai' as const,
          type: 'account_confirm' as const,
          text: `${tx.date} Gmail 영수증 "${tx.name}" ₩${Math.abs(tx.amount).toLocaleString('ko-KR')} 내역을 원장에 반영했어요. 항목과 계정을 함께 알려주세요.`,
          txId: Number(tx.id),
          options: buildConfirmOptionsForTx(tx),
          accountOptions: buildAccountOptions(knownAccounts),
          time: timeNow(),
        })),
      ],
    }))
    console.info('[GmailDebug][Store] inserted tx ids:', nextTxs.map((tx) => tx.id))
    return {
      insertedCount: nextTxs.length,
      insertedSourceRefs: fresh.map((item) => item.sourceMessageId),
      skippedDuplicateSourceRefs,
    }
  },

  ingestDocumentAnalysisBatch: (documentId, sourceLabel, items) => {
    const safeItems = items.filter((item) => Number(item?.amount) > 0)
    if (!safeItems.length) {
      return {
        insertedCount: 0,
        insertedTxIds: [],
      }
    }

    const knownAccounts = get().knownAccounts
    const nextTxs = safeItems.map((item, index) =>
      buildPendingTxFromParsed({
        merchant: item.merchant,
        date: item.date,
        amount: item.amount,
        category: item.category,
        reasoning: item.reasoning,
        confidence: item.confidence,
        account: item.account,
        linkedDocumentId: documentId,
        source: 'upload',
        sourceRef: item.sourceRef || `${documentId}:${index + 1}`,
        location: sourceLabel,
      })
    )
    const reviewTargets = nextTxs.slice(0, 3)

    set((s) => ({
      knownAccounts: Array.from(
        new Set([
          ...nextTxs.map((tx) => String(tx.account || '').trim()).filter(Boolean),
          ...s.knownAccounts,
        ])
      ),
      transactions: [...nextTxs, ...s.transactions],
      reviewPinnedTxIds: [
        ...new Set([...reviewTargets.map((tx) => tx.id), ...s.reviewPinnedTxIds]),
      ],
      messages: [
        ...s.messages,
        {
          id: ++_id,
          role: 'ai',
          type: 'text',
          text: buildDocumentSummaryText(sourceLabel, nextTxs.length, reviewTargets.length),
          time: timeNow(),
        },
        ...reviewTargets.map((tx) => ({
          id: ++_id,
          role: 'ai' as const,
          type: 'account_confirm' as const,
          text: `${tx.date} "${tx.name}" ₩${Math.abs(tx.amount).toLocaleString('ko-KR')} 내역을 반영했어요. 항목과 계정을 함께 확인해 주세요.`,
          txId: Number(tx.id),
          options: buildConfirmOptionsForTx(tx),
          accountOptions: buildAccountOptions([String(tx.account || ''), ...knownAccounts]),
          time: timeNow(),
        })),
      ],
    }))

    return {
      insertedCount: nextTxs.length,
      insertedTxIds: nextTxs.map((tx) => tx.id),
    }
  },

  exportBackupSnapshot: () => {
    const state = get()
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      messages: state.messages,
      knownAccounts: state.knownAccounts,
      lastLedgerDecision: state.lastLedgerDecision,
      ledgerContextTitle: state.ledgerContextTitle,
      activeLedgerFilter: state.activeLedgerFilter,
      reviewPinnedTxIds: state.reviewPinnedTxIds,
    }
  },

  restoreFromBackupSnapshot: (snapshot) => {
    const transactions = Array.isArray(snapshot?.transactions) ? snapshot.transactions : []
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
    const knownAccounts = Array.isArray(snapshot?.knownAccounts) ? snapshot.knownAccounts : []
    _id = computeNextInternalId(transactions, messages)

    set({
      transactions,
      messages,
      knownAccounts,
      lastLedgerDecision: snapshot?.lastLedgerDecision || null,
      ledgerContextTitle: snapshot?.ledgerContextTitle || '데이터 원장 (전체)',
      activeLedgerFilter: snapshot?.activeLedgerFilter || 'all',
      reviewPinnedTxIds: Array.isArray(snapshot?.reviewPinnedTxIds) ? snapshot.reviewPinnedTxIds : [],
      hoveredTxId: null,
      isDragging: false,
      isProcessing: false,
    })
  },

  syncPendingFromBackgroundQueue: async () => {
    const queued = await drainBackgroundPendingQueue()
    console.info('[GmailDebug][Store] drain queue size:', queued.length)
    if (!queued.length) return 0
    return get().ingestBackgroundParsedEntries(queued).insertedCount
  },

  processDroppedFiles: async () => {
    set({ isProcessing: true, isDragging: false })

    set((s) => ({
      messages: [...s.messages, { id: ++_id, role: 'ai', type: 'processing', text: '', time: timeNow() }],
    }))

    await new Promise((r) => setTimeout(r, 2800))

    const newTxId = String(++_id)
    const newTxs: VaultTransaction[] = [
      {
        id: String(++_id),
        createdAt: new Date().toISOString(),
        source: 'upload',
        date: '2026.04.05',
        merchant: '맥도날드 강남점',
        name: '맥도날드 강남점',
        location: '서울, KR',
        userMemo: '',
        category: '식비',
        type: 'EXPENSE',
        aiConfidence: 0.94,
        status: 'CONFIRMED',
        isInternal: false,
        linkedDocumentId: null,
        icon: 'fastfood',
        iconBg: '#ffc2c7',
        iconColor: '#891a33',
        amount: -8900,
      },
      {
        id: String(++_id),
        createdAt: new Date().toISOString(),
        source: 'upload',
        date: '2026.04.05',
        merchant: 'GS25 편의점',
        name: 'GS25 편의점',
        location: '서울역점',
        userMemo: '',
        category: '생활',
        type: 'EXPENSE',
        aiConfidence: 0.92,
        status: 'CONFIRMED',
        isInternal: false,
        linkedDocumentId: null,
        icon: 'local_convenience_store',
        iconBg: '#e5e9eb',
        iconColor: '#595c5e',
        amount: -4200,
      },
      {
        id: newTxId,
        createdAt: new Date().toISOString(),
        source: 'upload',
        date: '2026.04.05',
        merchant: '토스 송금',
        name: '토스 송금',
        location: '이영희',
        userMemo: '',
        category: '',
        type: 'TRANSFER',
        aiConfidence: 0.57,
        status: 'PENDING',
        isInternal: false,
        linkedDocumentId: null,
        icon: 'currency_exchange',
        iconBg: '#fcdf46',
        iconColor: '#5d5000',
        amount: -35000,
      },
    ]

    set((s) => ({
      isProcessing: false,
      transactions: [...newTxs, ...s.transactions],
      messages: [
        ...s.messages.filter((m) => m.type !== 'processing'),
        {
          id: ++_id,
          role: 'ai',
          type: 'result',
          text: '총 3건의 내역을 분석 및 분류했습니다.',
          subtitle: '직접 하셨다면 약 12분이 소요되었을 작업입니다',
          credit: '-0.3',
          time: timeNow(),
        },
        {
          id: ++_id,
          role: 'ai',
          type: 'confirm',
          text: '4월 5일 "토스 송금" ₩35,000 내역이 있네요. 이 송금은 어떤 분류인가요?',
          txId: Number(newTxId),
          options: [
            { label: '축의금', category: '경조사' },
            { label: '더치페이', category: '식비' },
            { label: '개인 송금', category: '이체' },
            { label: '직접입력…', category: '__CUSTOM__' },
          ],
          time: timeNow(),
        },
      ],
    }))
  },

  analyzeDocumentWithVision: async (documentId, file, fileType) => {
    const parsed = await analyzeDocumentWithGPT(file)
    const newTx = buildPendingTxFromParsed({
      merchant: parsed.merchant,
      date: parsed.date,
      amount: parsed.amount,
      category: parsed.category || (fileType === '세무' ? '세금' : '기타'),
      confidence: parsed.confidence,
      linkedDocumentId: documentId,
      source: 'upload',
      location: '',
    })

    set((s) => ({
      transactions: [newTx, ...s.transactions],
      messages: [
        ...s.messages,
        {
          id: ++_id,
          role: 'ai',
          type: 'confirm',
          text: `${newTx.date} "${newTx.name}" ₩${Math.abs(newTx.amount).toLocaleString('ko-KR')} 내역을 분류해 주세요.`,
          txId: Number(newTx.id),
          options: [
            { label: '식비', category: '식비' },
            { label: '교통비', category: '교통비' },
            { label: '생활비', category: '생활비' },
            { label: '직접입력…', category: '__CUSTOM__' },
          ],
          time: timeNow(),
        },
      ],
    }))

    return newTx.id
  },
}))

