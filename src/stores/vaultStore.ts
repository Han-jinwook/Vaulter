import { create } from 'zustand'
import type { Transaction } from '../types/schema'

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
type ChatType = 'text' | 'confirm' | 'processing' | 'result' | 'alert' | 'ledger_review'

type ConfirmOption = {
  label: string
  category: string
}

type ChatMessage = {
  id: number
  role: ChatRole
  type: ChatType
  text: string
  time: string
  resolved?: boolean
  txId?: number
  ledgerTxId?: number
  options?: ConfirmOption[] | string[]
  subtitle?: string
  credit?: string
}

type LedgerDecision = {
  ledgerTxId: number
  category: string
}

type VaultTransaction = Transaction & {
  id: string
  name: string
  location: string
  icon: string
  iconBg: string
  iconColor: string
}

type LedgerFilter = 'all' | 'review' | 'income' | 'expense'

type VaultState = {
  transactions: VaultTransaction[]
  messages: ChatMessage[]
  lastLedgerDecision: LedgerDecision | null
  ledgerContextTitle: string
  activeLedgerFilter: LedgerFilter
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
  processDroppedFiles: () => Promise<void>
  simulateDocumentParsing: (documentId: string, fileType: string) => Promise<string>
}

const initialTransactions: VaultTransaction[] = [
  {
    id: '1',
    date: '2026.04.05',
    merchant: '고메 버거 키친',
    name: '고메 버거 키친',
    location: '서울, KR',
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
    date: '2026.04.04',
    merchant: '급여 입금',
    name: '급여 입금',
    location: 'Vaulter Corp',
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
    date: '2026.04.04',
    merchant: '카카오페이 송금',
    name: '카카오페이 송금',
    location: '김민수',
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
    date: '2026.04.03',
    merchant: '스팀 상점',
    name: '스팀 상점',
    location: '온라인 결제',
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
    date: '2026.04.02',
    merchant: 'Netflix 구독',
    name: 'Netflix 구독',
    location: '자동결제',
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
  lastLedgerDecision: null,
  ledgerContextTitle: '데이터 원장 (전체)',
  activeLedgerFilter: 'all',
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
    set({ activeLedgerFilter: filter, ledgerContextTitle: titleMap[filter] })
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
            { label: '기타', category: '기타' },
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
        { id: ++_id, role: 'user', type: 'text', text: category, time: timeNow() },
        { id: ++_id, role: 'ai', type: 'text', text: `좋아요. '${category}'로 반영해둘게요.`, time: timeNow() },
      ],
    }))
  },

  clearLedgerDecision: () => set({ lastLedgerDecision: null }),

  confirmTransaction: (txId, category) => {
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx) return

    set((s) => ({
      transactions: s.transactions.map((t) =>
        t.id === txId ? { ...t, status: 'CONFIRMED', category } : t
      ),
      messages: [
        ...s.messages.map((m) =>
          m.type === 'confirm' && m.txId === Number(txId) ? { ...m, resolved: true } : m
        ),
        { id: ++_id, role: 'user', type: 'text', text: category, time: timeNow() },
        { id: ++_id, role: 'ai', type: 'text', text: `"${tx.name}"을(를) "${category}"(으)로 분류 완료했습니다!`, time: timeNow() },
      ],
    }))
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
        date: '2026.04.05',
        merchant: '맥도날드 강남점',
        name: '맥도날드 강남점',
        location: '서울, KR',
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
        date: '2026.04.05',
        merchant: 'GS25 편의점',
        name: 'GS25 편의점',
        location: '서울역점',
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
        date: '2026.04.05',
        merchant: '토스 송금',
        name: '토스 송금',
        location: '이영희',
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
            { label: '기타', category: '기타' },
          ],
          time: timeNow(),
        },
      ],
    }))
  },

  simulateDocumentParsing: async (documentId, fileType) => {
    await new Promise((r) => setTimeout(r, 2400))

    const now = todayDate()
    const txSeed =
      fileType === '세무'
        ? {
            merchant: '국세청',
            amount: -850000,
            category: '세금',
            icon: 'account_balance',
            iconBg: '#ffe8c2',
            iconColor: '#875100',
          }
        : {
            merchant: '마장동 한우촌',
            amount: -150000,
            category: '식비',
            icon: 'receipt_long',
            iconBg: '#ffd3dc',
            iconColor: '#7d2438',
          }

    const newTx: VaultTransaction = {
      id: String(++_id),
      date: now,
      merchant: txSeed.merchant,
      name: txSeed.merchant,
      location: '금고 문서 파싱',
      category: txSeed.category,
      type: 'EXPENSE',
      aiConfidence: 0.85,
      status: 'PENDING',
      isInternal: false,
      linkedDocumentId: documentId,
      icon: txSeed.icon,
      iconBg: txSeed.iconBg,
      iconColor: txSeed.iconColor,
      amount: txSeed.amount,
    }

    set((s) => ({
      transactions: [newTx, ...s.transactions],
    }))

    return newTx.id
  },
}))

