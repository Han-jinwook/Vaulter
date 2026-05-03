import { create } from 'zustand'
import type { AssetLine } from '../types/assetLine'
import type { Transaction } from '../types/schema'
import {
  analyzeDocumentWithGPT,
  type DocumentParseResult,
} from '../lib/visionAIEngine'
import {
  drainBackgroundPendingQueue,
  type BackgroundParsedItem,
} from '../lib/gmailSync'
import { flushLocalVaultSnapshotToKv } from '../lib/flushLocalVaultSnapshot'
import {
  deleteLedgerLine,
  putLedgerLine,
  putLedgerLinesBatch,
  writeAllLedgerLines,
} from '../lib/localVaultPersistence'

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
type ChatType =
  | 'text'
  | 'confirm'
  | 'account_confirm'
  | 'processing'
  | 'result'
  | 'alert'
  | 'ledger_review'
  | 'ledger_delete_confirm'

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
  createdAt?: string
  /** 지기 탭 등 라우팅 유도 버튼 */
  cta?: { label: string; to: string }
  resolved?: boolean
  txId?: number
  ledgerTxId?: number
  options?: ConfirmOption[] | string[]
  accountOptions?: ConfirmOption[]
  subtitle?: string
  credit?: string
  /** 턴 종료 시점 원장 필터(해당 말풍선에서만 「원장 다시보기」 제공) */
  ledgerBrowseSnapshot?: { label: string; transactionIds: string[] }
  /** delete_ledger 스테이징 후 예·아니오 칩 */
  ledgerDeleteConfirm?: {
    items: { txId: string; date: string; name: string; amount: number; category: string }[]
  }
}

type LedgerDecision = {
  ledgerTxId: number
  category: string
}

export type VaultTransaction = Transaction & {
  id: string
  createdAt: string
  source: 'upload' | 'gmail' | 'manual' | 'webhook'
  sourceRef?: string
  name: string
  location: string
  userMemo: string
  icon: string
  iconBg: string
  iconColor: string
}

type LedgerFilter = 'all' | 'review' | 'income' | 'expense'

/** 원장 상단 — 연 전체 또는 연+월 기준 기간 (베이스 필터) */
export type LedgerPeriodPreset =
  | { kind: 'all' }
  | { kind: 'year'; year: number }
  | { kind: 'month'; year: number; month: number }

function normalizeLedgerPeriodPreset(raw: unknown): LedgerPeriodPreset {
  if (!raw || typeof raw !== 'object') return { kind: 'all' }
  const o = raw as { kind?: unknown; year?: unknown; month?: unknown }
  if (o.kind === 'year' && typeof o.year === 'number' && Number.isFinite(o.year)) {
    return { kind: 'year', year: Math.floor(o.year) }
  }
  if (
    o.kind === 'month' &&
    typeof o.year === 'number' &&
    typeof o.month === 'number' &&
    Number.isFinite(o.year) &&
    Number.isFinite(o.month)
  ) {
    const month = Math.min(12, Math.max(1, Math.floor(o.month)))
    return { kind: 'month', year: Math.floor(o.year), month }
  }
  return { kind: 'all' }
}

/** 원장 항목(카테고리) 필터: 분류가 비어 있는 거래만 볼 때 사용하는 내부 값 */
export const LEDGER_CATEGORY_FILTER_UNASSIGNED = '__ledger_cat_unassigned__'

type IngestBackgroundResult = {
  insertedCount: number
  insertedSourceRefs: string[]
  skippedDuplicateSourceRefs: string[]
}

type IngestWebhookInboxResult = {
  insertedCount: number
  insertedKeys: string[]
  skippedDuplicateKeys: string[]
}

type IngestDocumentBatchResult = {
  insertedCount: number
  insertedTxIds: string[]
}

/** 비밀금고 탭 — 등록된 증빙 메타(Phase 1 로컬) */
export type SecretVaultDocument = {
  id: string
  date: string
  title: string
  target: string
  expiry_date: string | null
  category: string
  memo: string
}

export type BudgetGoalItem = {
  id: string
  title: string
  targetAmount: number
  currentAmount: number
  targetDate: string
  createdAt: string
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
  /** 구버전 스냅샷에는 없을 수 있음 */
  ledgerPeriodPreset?: LedgerPeriodPreset
  ledgerAccountFilter?: string | null
  ledgerCategoryFilter?: string | null
  reviewPinnedTxIds: string[]
  /** 황금자산(IndexedDB `assets`와 동기). 구버전 스냅샷에는 없을 수 있음 */
  goldenAssetLines?: AssetLine[]
  /** 황금자산 탭 전용 채팅 (지기 messages 와 분리) */
  assetMessages?: ChatMessage[]
  /** 예산&목표 탭 전용 채팅 (코치) */
  budgetMessages?: ChatMessage[]
  /** 예산&목표 저장 목표 카드 */
  budgetGoals?: BudgetGoalItem[]
  /** 비밀금고 탭 전용 채팅 */
  vaultMessages?: ChatMessage[]
  /** 비밀금고 문서 메타(로컬) */
  secretVaultDocuments?: SecretVaultDocument[]
}

type VaultState = {
  transactions: VaultTransaction[]
  messages: ChatMessage[]
  assetMessages: ChatMessage[]
  budgetMessages: ChatMessage[]
  budgetGoals: BudgetGoalItem[]
  vaultMessages: ChatMessage[]
  secretVaultDocuments: SecretVaultDocument[]
  knownAccounts: string[]
  lastLedgerDecision: LedgerDecision | null
  ledgerContextTitle: string
  activeLedgerFilter: LedgerFilter
  ledgerPeriodPreset: LedgerPeriodPreset
  ledgerAccountFilter: string | null
  ledgerCategoryFilter: string | null
  reviewPinnedTxIds: string[]
  hoveredTxId: string | null
  isDragging: boolean
  isProcessing: boolean

  setLedgerContextByFilter: (filter: LedgerFilter) => void
  setLedgerPeriodPreset: (preset: LedgerPeriodPreset) => void
  setLedgerAccountFilter: (account: string | null) => void
  setLedgerCategoryFilter: (category: string | null) => void
  setLedgerAiReviewContext: () => void
  setHoveredTx: (id: string | null) => void
  setDragging: (v: boolean) => void
  simulateEmailLanding: () => void
  acknowledgeAlert: (messageId: number, label: string) => void
  askAboutTransaction: (txId: string) => void
  askLedgerReview: (tx: VaultTransaction) => void
  resolveLedgerReview: (messageId: number, ledgerTxId: number, category: string) => void
  clearLedgerDecision: () => void
  confirmTransaction: (txId: string, category: string) => Promise<void>
  confirmTransactionAccount: (txId: string, account: string) => Promise<void>
  completeTransactionReview: (txId: string, category: string, account: string) => Promise<void>
  updateTransactionInline: (
    txId: string,
    patch: Partial<Pick<VaultTransaction, 'name' | 'location' | 'userMemo' | 'category' | 'amount' | 'account'>>
  ) => Promise<void>
  /** IndexedDB `ledger_lines` 1행 추가 + Zustand (원장/요약 갱신) */
  addLine: (tx: VaultTransaction) => Promise<void>
  addLines: (txs: VaultTransaction[]) => Promise<void>
  updateLine: (txId: string, patch: Partial<Pick<VaultTransaction, 'name' | 'location' | 'userMemo' | 'category' | 'amount' | 'account' | 'status' | 'type' | 'date' | 'merchant'>>) => Promise<void>
  deleteLine: (txId: string) => Promise<void>
  /** 지기 AI `add_ledger_entry` — 원장에 수동 거래 1건 추가 */
  addLedgerEntry: (input: {
    type: 'EXPENSE' | 'INCOME'
    category: string
    amount: number
    date: string
    /** 적요(짧은 키워드) */
    summary: string
    /** 추가 메모(없으면 생략) */
    detail_memo?: string
    account?: string
  }) => Promise<
    | {
        success: true
        txId: string
        summary: {
          date: string
          amount: number
          category: string
          memo: string
          detail_memo: string
          type: 'EXPENSE' | 'INCOME'
        }
      }
    | { success: false; error: string }
  >
  ingestBackgroundParsedEntries: (items: BackgroundParsedItem[]) => Promise<IngestBackgroundResult>
  /** Netlify Blobs 대기 큐 → 로컬 원장 (sourceRef: webhook:… 로 중복 제거) */
  ingestWebhookInboxItems: (items: { key: string; parsed: { type: string; category: string; amount: number; date: string; title: string } }[]) => Promise<IngestWebhookInboxResult>
  ingestDocumentAnalysisBatch: (
    documentId: string,
    sourceLabel: string,
    items: DocumentParseResult[]
  ) => Promise<IngestDocumentBatchResult>
  addChatMessage: (msg: Omit<Partial<ChatMessage>, 'id' | 'time'> & { text: string }) => void
  addAssetChatMessage: (msg: Omit<Partial<ChatMessage>, 'id' | 'time'> & { text: string }) => void
  addBudgetChatMessage: (msg: Omit<Partial<ChatMessage>, 'id' | 'time'> & { text: string }) => void
  upsertBudgetGoal: (input: {
    title: string
    targetAmount: number
    currentAmount?: number
    targetDate?: string
  }) => BudgetGoalItem
  addVaultChatMessage: (msg: Omit<Partial<ChatMessage>, 'id' | 'time'> & { text: string }) => void
  /** 원장 삭제 확인 칩 처리 후 버튼 숨김 */
  resolveLedgerDeleteConfirmMessage: (messageId: number) => void
  addSecretVaultDocument: (doc: Omit<SecretVaultDocument, 'id'> & { id?: string }) => SecretVaultDocument
  exportBackupSnapshot: () => VaultBackupSnapshot
  restoreFromBackupSnapshot: (snapshot: VaultBackupSnapshot) => void
  syncPendingFromBackgroundQueue: () => Promise<number>
  processDroppedFiles: () => Promise<void>
  analyzeDocumentWithVision: (documentId: string, file: File, fileType: string) => Promise<string>
}

/** 지기 `add_ledger_entry`가 넘기는 고정 분류(서버 프롬프트·툴 Enum과 동일) */
const KEEPER_LEDGER_EXPENSE_CATEGORIES = [
  '식비',
  '교통/차량',
  '쇼핑/뷰티',
  '주거/통신',
  '문화/여가',
  '건강/병원',
  '이자/금융수수료',
  '카드대금 결제',
  '대출 상환',
  '기타 지출',
] as const
const KEEPER_LEDGER_INCOME_CATEGORIES = ['급여', '부수입', '금융 수입', '기타 수입'] as const

const KEEPER_EXPENSE_SET = new Set<string>(KEEPER_LEDGER_EXPENSE_CATEGORIES)
const KEEPER_INCOME_SET = new Set<string>(KEEPER_LEDGER_INCOME_CATEGORIES)

function normalizeKeeperAddLedgerCategory(
  type: 'EXPENSE' | 'INCOME',
  category: string,
): string {
  const raw = String(category || '').trim()
  if (raw) return raw
  const allow = type === 'INCOME' ? KEEPER_INCOME_SET : KEEPER_EXPENSE_SET
  if (allow.has(raw)) return raw
  return type === 'INCOME' ? '기타 수입' : '기타 지출'
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

/** 계정 목록 후보 전체를 드롭다운에 올린다 — 개수 자체에 상한 두지 않음(유일값·소트만). */
function buildAccountOptions(knownAccounts: string[]): ConfirmOption[] {
  const unique = Array.from(
    new Set(knownAccounts.map((x) => String(x || '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'ko'))
  if (!unique.length) return []
  return unique.map((account) => ({ label: account, category: account }))
}

function hasMeaningfulCategory(tx: Pick<VaultTransaction, 'category'>): boolean {
  return Boolean(String(tx?.category || '').trim())
}

function normalizeMerchantSlug(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '')
}

function merchantsLooselySame(a: string, b: string): boolean {
  const na = normalizeMerchantSlug(a)
  const nb = normalizeMerchantSlug(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length < 4 || nb.length < 4) return false
  return na.includes(nb) || nb.includes(na)
}

/** 항목(분류): 원장 과거 거래 매칭 → 최대 3 + 직접입력 … */
function pickCategoryCandidates(
  tx: VaultTransaction,
  transactions: VaultTransaction[],
): ConfirmOption[] {
  const scores = new Map<string, number>()
  for (const o of transactions) {
    if (o.id === tx.id) continue
    if (o.status !== 'CONFIRMED') continue
    const m1 = String(tx.name || tx.merchant || '').trim()
    const m2 = String(o.name || o.merchant || '').trim()
    if (!merchantsLooselySame(m1, m2)) continue
    const c = String(o.category || '').trim()
    if (!c || c === '기타') continue
    scores.set(c, (scores.get(c) ?? 0) + 1)
  }
  const fromHistory = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category]) => ({ label: category, category }))

  const pool = buildConfirmOptionsForTx(tx).filter((x) => x.category !== '__CUSTOM__')
  const merged: ConfirmOption[] = []
  const seen = new Set<string>()
  for (const opt of [...fromHistory, ...pool]) {
    if (seen.has(opt.category)) continue
    seen.add(opt.category)
    merged.push(opt)
    if (merged.length >= 3) break
  }
  while (merged.length < 3 && pool.length > 0) {
    const p = pool.find((x) => !seen.has(x.category))
    if (!p) break
    seen.add(p.category)
    merged.push(p)
  }
  return [...merged, { label: '직접입력…', category: '__CUSTOM__' }]
}

function toFactDate(dateText: string): string {
  const raw = String(dateText || '').trim()
  if (!raw) return todayDate().replace(/\./g, '-')
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(raw)) return raw.replace(/\./g, '-')
  return raw
}

function toWon(amount: number): string {
  return `₩${Math.abs(Number(amount) || 0).toLocaleString('ko-KR')}`
}

function buildFactLineForTx(tx: VaultTransaction): string {
  const parts = [
    toFactDate(tx.date),
    String(tx.name || tx.merchant || '').trim(),
    String(tx.userMemo || '').trim(),
    toWon(tx.amount),
    String(tx.category || '').trim(),
  ].filter((v) => Boolean(String(v || '').trim()))
  return parts.length ? `${parts.join(', ')}.` : ''
}

/** 시트/파싱에 계정 문자열이 있어도, 구체 은행·카드명이 없으면 한 번 더 묻는다 (채팅 N건 감소용) */
function needsAccountClarification(tx: Pick<VaultTransaction, 'account'>): boolean {
  const a = String(tx.account || '').trim()
  if (!a) return true
  if (/계정\s*미|미지정|미입력|해당없|해당\s*없|없음|^\s*[-–—]\s*$/.test(a)) return true
  const compact = a.replace(/\s+/g, '')
  if (/^(은행이체|계좌이체|이체|송금|미지정|미입력)$/.test(compact)) return true
  if (/^은행이체$|^계좌이체$/i.test(a.replace(/\s+/g, ' ').trim())) return true
  if (/(은행이체|계좌이체)/.test(a)) {
    if (
      /(국민|신한|하나|우리|농협|농협은행|IBK|ibk|기업|KDB|iM|KDB|SC|씨티|씨티은행|토스|카카오|Kakao|KB|Kbank|케이뱅|새마을|수협|대구|부산|경남|전북|우체|저축|제주|광주|신협|지역|KDB|iM|hyundai|lotte|samsung|nh|keb|hana|shinhan|woori|pay|페이|IBK|하나|기업은행|신한은행|국민은행)/i.test(
        a,
      )
    ) {
      return false
    }
    return true
  }
  return false
}

function buildAccountClarifyMessage(
  tx: VaultTransaction,
  knownAccounts: string[],
  transactionsForCategoryHints: VaultTransaction[] = [],
): Omit<ChatMessage, 'id' | 'time'> {
  const factLine = buildFactLineForTx(tx)
  const lockedCategoryRaw = String(tx.category || '').trim()
  const isIncome = tx.type === 'INCOME' || Number(tx.amount) > 0
  const acc = String(tx.account || '').trim()
  const bankVague =
    Boolean(acc) &&
    (/^(은행이체|계좌이체|이체|송금)$/i.test(acc.replace(/\s/g, '')) ||
      (/(은행이체|계좌이체)/.test(acc) &&
        !/(국민|신한|하나|우리|농협|IBK|ibk|기업|KDB|iM|SC|씨티|토스|카카오|KB|Kbank|새마을|수협|대구|부산|경남|전북|우체|저축|제주|광주|신협|씨티은행|하나은행|기업은행|신한은행|국민은행|NH|KEB|hana|shinhan|woori|hyundai|lotte|samsung|pay|페이|농협|kakao|Kakao|ibk)/i.test(
          acc,
        )))
  const question = (() => {
    if (!acc) {
      return isIncome
        ? `**어느 통장·계정**으로 입금·수취되었는지 알려 주세요. (현금/카드/통장명)`
        : `**어느 카드·현금·통장**으로 결제·출금하셨는지 알려 주세요.`
    }
    if (bankVague && isIncome) {
      return `시트에「${acc}」로만 되어 있어요. **어느 은행·통장(계정)**으로 기록할까요? (예: 국민 급여통장, 신한 입출금)`
    }
    if (bankVague && !isIncome) {
      return `「${acc}」이(가) **어느 통장·카드·현금**인지 구체적으로 알려 주세요.`
    }
    if (isIncome) {
      return `**어느 통장·계정**으로 입금·수취되었는지 알려 주세요. (현금/카드/통장명)`
    }
    return `**어느 카드·현금·통장**으로 결제·출금하셨는지 알려 주세요.`
  })()
  const categoryOptionsForMsg: ConfirmOption[] = lockedCategoryRaw
    ? [{ label: lockedCategoryRaw, category: lockedCategoryRaw }]
    : pickCategoryCandidates(tx, transactionsForCategoryHints)

  return {
    role: 'ai',
    type: 'account_confirm',
    text: `${factLine}\n${question}`,
    txId: Number(tx.id),
    options: categoryOptionsForMsg,
    accountOptions: buildAccountOptions([String(tx.account || ''), ...knownAccounts]),
  }
}

function buildDocumentSummaryText(
  sourceLabel: string,
  insertedCount: number,
  reviewCount: number,
  autoConfirmedCount?: number,
) {
  const auto = autoConfirmedCount ?? 0
  if (reviewCount > 0 && auto > 0) {
    return `"${sourceLabel}"에서 총 ${insertedCount}건을 반영했어요. ${auto}건은 시트의 결제수단으로 **바로 확정**했고, **${reviewCount}건**만 아래에서 계정을 보완해 주세요. (나머지는 원장·목록에서 확인하시면 돼요.)`
  }
  if (reviewCount > 0) {
    return `"${sourceLabel}"에서 ${insertedCount}건을 반영했어요. **${reviewCount}건**만 아래에서 계정을 확인해 주세요.`
  }
  if (auto > 0) {
    return `"${sourceLabel}"에서 ${insertedCount}건을 시트의 결제수단·분류로 **모두 확정**해 두었어요. 원장·목록에서 점검해 주세요.`
  }
  return `"${sourceLabel}"에서 ${insertedCount}건을 반영했어요.`
}

function computeNextInternalId(
  transactions: VaultTransaction[],
  messages: ChatMessage[],
  assetMessages: ChatMessage[] = [],
  budgetMessages: ChatMessage[] = [],
  vaultMessages: ChatMessage[] = [],
) {
  const txMax = transactions.reduce((max, tx) => Math.max(max, Number(tx.id) || 0), 0)
  const msgMax = messages.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0)
  const assetMsgMax = assetMessages.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0)
  const budgetMsgMax = budgetMessages.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0)
  const vaultMsgMax = vaultMessages.reduce((max, msg) => Math.max(max, Number(msg.id) || 0), 0)
  return Math.max(100, txMax, msgMax, assetMsgMax, budgetMsgMax, vaultMsgMax)
}

function buildPendingTxFromParsed(input: {
  merchant?: string
  date?: string | null
  amount?: number
  category?: string
  /** AI·문서 설명(스프레드시트 메모는 `memo`) */
  reasoning?: string
  memo?: string
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
    /수입|환급|입금|급여|부수입|용돈|보너스|배당|환불|캐시백|적립/.test(normalizedCategory)
      ? 'INCOME'
      : 'EXPENSE'
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
    userMemo:
      String(input.memo || '').trim() ||
      String(input.reasoning || '').trim() ||
      '',
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

/** 지기 AI `add_ledger_entry` — 유저가 직접 말로 확정한 수입/지출 1건 */
function buildVaultTxFromAiLedgerEntry(input: {
  type: 'EXPENSE' | 'INCOME'
  category: string
  amount: number
  date: string
  summary: string
  detail_memo?: string
  account?: string
}): VaultTransaction {
  const amountAbs = Math.abs(Number(input.amount))
  if (!Number.isFinite(amountAbs) || amountAbs <= 0) {
    throw new Error('INVALID_AMOUNT')
  }
  const txType: Transaction['type'] = input.type === 'INCOME' ? 'INCOME' : 'EXPENSE'
  const signed = txType === 'INCOME' ? amountAbs : -amountAbs
  const summ = String(input.summary || '').trim() || '내용'
  const extra = String(input.detail_memo || '').trim()
  const categoryNorm = normalizeKeeperAddLedgerCategory(
    input.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
    String(input.category || '').trim(),
  )
  const isTax = /세금|국세청|공과금/.test(`${categoryNorm} ${summ} ${extra}`)
  const acct = String(input.account || '').trim()
  const title = summ.length > 120 ? `${summ.slice(0, 117)}…` : summ

  return {
    id: String(++_id),
    createdAt: new Date().toISOString(),
    source: 'manual',
    date: normalizeApiDate(input.date),
    merchant: title,
    name: title,
    location: '',
    userMemo: extra,
    category: categoryNorm,
    type: txType,
    aiConfidence: 1,
    status: 'CONFIRMED',
    isInternal: false,
    linkedDocumentId: null,
    icon: txType === 'INCOME' ? 'payments' : isTax ? 'account_balance' : 'receipt_long',
    iconBg: txType === 'INCOME' ? '#6e9fff' : isTax ? '#ffe8c2' : '#ffd3dc',
    iconColor: txType === 'INCOME' ? '#002150' : isTax ? '#875100' : '#7d2438',
    amount: signed,
    ...(acct ? { account: acct } : {}),
  }
}

function buildVaultTxFromWebhookInbox(input: {
  queueKey: string
  type: 'EXPENSE' | 'INCOME'
  category: string
  amount: number
  date: string
  title: string
}): VaultTransaction {
  return {
    ...buildVaultTxFromAiLedgerEntry({
      type: input.type,
      category: input.category,
      amount: input.amount,
      date: input.date,
      summary: String(input.title || '내용')
        .trim()
        .slice(0, 120),
      detail_memo: undefined,
    }),
    source: 'webhook',
    sourceRef: `webhook:${input.queueKey}`,
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
  assetMessages: [],
  budgetMessages: [],
  budgetGoals: [],
  vaultMessages: [],
  secretVaultDocuments: [],
  knownAccounts: [],
  lastLedgerDecision: null,
  ledgerContextTitle: '데이터 원장 (전체)',
  activeLedgerFilter: 'all',
  ledgerPeriodPreset: { kind: 'all' },
  ledgerAccountFilter: null,
  ledgerCategoryFilter: null,
  reviewPinnedTxIds: [],
  hoveredTxId: null,
  isDragging: false,
  isProcessing: false,

  setLedgerContextByFilter: (filter) => {
    const titleMap: Record<LedgerFilter, string> = {
      all: '데이터 원장 (유형 전체)',
      income: '수입 내역',
      expense: '지출 내역',
      review: '미분류/검토 대기 내역',
    }
    set({
      activeLedgerFilter: filter,
      ledgerContextTitle: titleMap[filter],
      reviewPinnedTxIds: filter === 'review' ? get().reviewPinnedTxIds : [],
    })
  },

  setLedgerPeriodPreset: (preset) => {
    set({ ledgerPeriodPreset: normalizeLedgerPeriodPreset(preset) })
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  setLedgerAccountFilter: (account) => {
    const next = account != null && String(account).trim() ? String(account).trim() : null
    set({ ledgerAccountFilter: next })
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  setLedgerCategoryFilter: (category) => {
    let next: string | null = null
    if (category === LEDGER_CATEGORY_FILTER_UNASSIGNED) next = LEDGER_CATEGORY_FILTER_UNASSIGNED
    else if (category != null && String(category).trim()) next = String(category).trim()
    set({ ledgerCategoryFilter: next })
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  setLedgerAiReviewContext: () => {
    set({ activeLedgerFilter: 'review', ledgerContextTitle: '🚨 AI와 함께 집중 검토 중' })
  },

  setHoveredTx: (id) => set({ hoveredTxId: id }),
  setDragging: (v) => set({ isDragging: v }),

  addLine: async (tx) => {
    await putLedgerLine(tx)
    const acc = String(tx.account || '').trim()
    set((s) => ({
      transactions: [tx, ...s.transactions],
      knownAccounts: acc ? Array.from(new Set([acc, ...s.knownAccounts])) : s.knownAccounts,
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  addLines: async (txs) => {
    if (!txs.length) return
    await putLedgerLinesBatch(txs)
    set((s) => ({ transactions: [...txs, ...s.transactions] }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  updateLine: async (txId, patch) => {
    const t = get().transactions.find((x) => x.id === txId)
    if (!t) return
    const next: VaultTransaction = { ...t, ...patch }
    if (patch.name !== undefined) {
      next.merchant = patch.name
    }
    await putLedgerLine(next)
    set((s) => ({
      transactions: s.transactions.map((x) => (x.id === txId ? next : x)),
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  deleteLine: async (txId) => {
    await deleteLedgerLine(txId)
    set((s) => ({ transactions: s.transactions.filter((x) => x.id !== txId) }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

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
          time: timeNow(), createdAt: new Date().toISOString(),
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
        { id: ++_id, role: 'user', type: 'text', text: label, time: timeNow(), createdAt: new Date().toISOString() },
      ],
    }))
  },

  askAboutTransaction: (txId) => {
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx || tx.status !== 'PENDING') return
    const alreadyAsked = get().messages.some(
      (m) =>
        (m.type === 'confirm' || m.type === 'account_confirm') &&
        m.txId === Number(txId) &&
        !m.resolved
    )
    if (alreadyAsked) return

    const categoryLocked = hasMeaningfulCategory(tx)
    set((s) => ({
      messages: [
        ...s.messages,
        categoryLocked
          ? {
              id: ++_id,
              ...buildAccountClarifyMessage(tx, s.knownAccounts, s.transactions),
              time: timeNow(), createdAt: new Date().toISOString(),
            }
          : {
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
              time: timeNow(), createdAt: new Date().toISOString(),
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
          time: timeNow(), createdAt: new Date().toISOString(),
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

  confirmTransaction: async (txId, category) => {
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx || tx.status === 'CONFIRMED') return
    const nextCategory = String(category || '').trim()
    if (!nextCategory) return
    const next: VaultTransaction = { ...tx, status: 'CONFIRMED', category: nextCategory }
    await putLedgerLine(next)
    set((s) => ({
      transactions: s.transactions.map((t) => (t.id === txId ? next : t)),
      reviewPinnedTxIds: s.reviewPinnedTxIds.includes(txId)
        ? s.reviewPinnedTxIds
        : [txId, ...s.reviewPinnedTxIds],
      messages: [
        ...s.messages.map((m) =>
          m.type === 'confirm' && m.txId === Number(txId) ? { ...m, resolved: true } : m
        ),
      ],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  confirmTransactionAccount: async (txId, account) => {
    const nextAccount = String(account || '').trim()
    if (!nextAccount) return
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx) return
    const next: VaultTransaction = { ...tx, account: nextAccount }
    await putLedgerLine(next)
    set((s) => ({
      knownAccounts: Array.from(new Set([nextAccount, ...s.knownAccounts])),
      transactions: s.transactions.map((t) => (t.id === txId ? next : t)),
      messages: [
        ...s.messages.map((m) =>
          m.type === 'account_confirm' && m.txId === Number(txId) ? { ...m, resolved: true } : m
        ),
      ],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  completeTransactionReview: async (txId, category, account) => {
    const nextCategory = String(category || '').trim()
    const nextAccount = String(account || '').trim()
    if (!nextCategory || !nextAccount) return
    const tx = get().transactions.find((t) => t.id === txId)
    if (!tx) return
    const next: VaultTransaction = {
      ...tx,
      status: 'CONFIRMED',
      category: nextCategory,
      account: nextAccount,
    }
    await putLedgerLine(next)
    set((s) => ({
      knownAccounts: Array.from(new Set([nextAccount, ...s.knownAccounts])),
      transactions: s.transactions.map((t) => (t.id === txId ? next : t)),
      reviewPinnedTxIds: s.reviewPinnedTxIds.includes(txId)
        ? s.reviewPinnedTxIds
        : [txId, ...s.reviewPinnedTxIds],
      messages: s.messages.map((m) =>
        (m.type === 'confirm' || m.type === 'account_confirm') && m.txId === Number(txId)
          ? { ...m, resolved: true }
          : m
      ),
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  updateTransactionInline: async (txId, patch) => {
    const t = get().transactions.find((x) => x.id === txId)
    if (!t) return
    const next: VaultTransaction = { ...t, ...patch }
    if (patch.name !== undefined) {
      next.merchant = patch.name
    }
    await putLedgerLine(next)
    set((s) => ({
      knownAccounts:
        patch.account && String(patch.account).trim()
          ? Array.from(new Set([String(patch.account).trim(), ...s.knownAccounts]))
          : s.knownAccounts,
      transactions: s.transactions.map((x) => (x.id === txId ? next : x)),
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  addLedgerEntry: async (input) => {
    try {
      const newTx = buildVaultTxFromAiLedgerEntry(input)
      await get().addLine(newTx)
      return {
        success: true,
        txId: newTx.id,
        summary: {
          date: newTx.date,
          amount: newTx.amount,
          category: newTx.category,
          memo: newTx.merchant,
          detail_memo: newTx.userMemo || '',
          type: newTx.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
        },
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'INVALID_AMOUNT') {
        return { success: false, error: '금액은 0보다 큰 숫자여야 합니다.' }
      }
      return { success: false, error: e instanceof Error ? e.message : '원장에 추가하지 못했습니다.' }
    }
  },

  ingestBackgroundParsedEntries: async (items) => {
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

    const nextTxs = fresh.map((item) => {
      const row = buildPendingTxFromParsed({
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
      return {
        ...row,
        status: needsAccountClarification(row) ? ('PENDING' as const) : ('CONFIRMED' as const),
      }
    })
    const needList = nextTxs.filter(needsAccountClarification)
    const autoCount = nextTxs.length - needList.length
    const maxPrompts = autoCount > 0 ? 1 : Math.min(needList.length, 3)
    const reviewTargets = needList.slice(0, maxPrompts)

    await putLedgerLinesBatch(nextTxs)
    set((s) => ({
      transactions: [...nextTxs, ...s.transactions],
      messages: [
        ...s.messages,
        ...reviewTargets.map((tx) => ({
          id: ++_id,
          ...buildAccountClarifyMessage(tx, s.knownAccounts, [...nextTxs, ...s.transactions]),
          time: timeNow(), createdAt: new Date().toISOString(),
        })),
      ],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
    console.info('[GmailDebug][Store] inserted tx ids:', nextTxs.map((tx) => tx.id))
    return {
      insertedCount: nextTxs.length,
      insertedSourceRefs: fresh.map((item) => item.sourceMessageId),
      skippedDuplicateSourceRefs,
    }
  },

  ingestWebhookInboxItems: async (items) => {
    if (!items.length) {
      return { insertedCount: 0, insertedKeys: [], skippedDuplicateKeys: [] }
    }
    const current = get().transactions
    const known = new Set(current.map((tx) => tx.sourceRef).filter((r): r is string => Boolean(r)))
    const fresh = items.filter((it) => {
      const ref = `webhook:${it.key}`
      return !known.has(ref)
    })
    const skippedDuplicateKeys = items
      .filter((it) => known.has(`webhook:${it.key}`))
      .map((it) => it.key)
    if (!fresh.length) {
      return { insertedCount: 0, insertedKeys: [], skippedDuplicateKeys }
    }
    const nextTxs: VaultTransaction[] = []
    for (const it of fresh) {
      const p = it.parsed
      const t = String(p.type || '')
        .toUpperCase() === 'INCOME'
        ? 'INCOME'
        : 'EXPENSE'
      try {
        const tx = buildVaultTxFromWebhookInbox({
          queueKey: it.key,
          type: t,
          category: p.category,
          amount: p.amount,
          date: p.date,
          title: p.title,
        })
        nextTxs.push(tx)
      } catch {
        // INVALID_AMOUNT 등은 건너뜀
      }
    }
    if (!nextTxs.length) {
      return { insertedCount: 0, insertedKeys: [], skippedDuplicateKeys }
    }
    await putLedgerLinesBatch(nextTxs)
    set((s) => ({
      transactions: [...nextTxs, ...s.transactions],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
    return {
      insertedCount: nextTxs.length,
      insertedKeys: nextTxs.map((tx) => String(tx.sourceRef).replace(/^webhook:/, '')),
      skippedDuplicateKeys,
    }
  },

  ingestDocumentAnalysisBatch: async (documentId, sourceLabel, items) => {
    const safeItems = items.filter((item) => Number(item?.amount) > 0)
    if (!safeItems.length) {
      return {
        insertedCount: 0,
        insertedTxIds: [],
      }
    }

    const nextTxs = safeItems.map((item, index) => {
      const row = buildPendingTxFromParsed({
        merchant: item.merchant,
        date: item.date,
        amount: item.amount,
        category: item.category,
        reasoning: item.reasoning,
        memo: item.memo,
        confidence: item.confidence,
        account: item.account,
        linkedDocumentId: documentId,
        source: 'upload',
        sourceRef: item.sourceRef || `${documentId}:${index + 1}`,
        location: sourceLabel,
      })
      return {
        ...row,
        status: needsAccountClarification(row) ? ('PENDING' as const) : ('CONFIRMED' as const),
      }
    })
    const needList = nextTxs.filter(needsAccountClarification)
    const autoCount = nextTxs.length - needList.length
    const maxAccountPrompts = autoCount > 0 ? 1 : Math.min(needList.length, 3)
    const reviewTargets = needList.slice(0, maxAccountPrompts)

    await putLedgerLinesBatch(nextTxs)
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
          text: buildDocumentSummaryText(
            sourceLabel,
            nextTxs.length,
            reviewTargets.length,
            autoCount,
          ),
          time: timeNow(), createdAt: new Date().toISOString(),
        },
        ...reviewTargets.map((tx) => ({
          id: ++_id,
          ...buildAccountClarifyMessage(tx, s.knownAccounts, [...nextTxs, ...s.transactions]),
          time: timeNow(), createdAt: new Date().toISOString(),
        })),
      ],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})

    return {
      insertedCount: nextTxs.length,
      insertedTxIds: nextTxs.map((tx) => tx.id),
    }
  },

  addChatMessage: (msg) => {
    set((s) => ({
      messages: [
        ...s.messages,
        {
          ...msg,
          id: ++_id,
          role: (msg.role as ChatRole) || 'ai',
          type: (msg.type as ChatType) || 'text',
          time: timeNow(),
          createdAt: new Date().toISOString(),
        } as ChatMessage,
      ],
    }))
  },

  addAssetChatMessage: (msg) => {
    set((s) => ({
      assetMessages: [
        ...s.assetMessages,
        {
          ...msg,
          id: ++_id,
          role: (msg.role as ChatRole) || 'ai',
          type: (msg.type as ChatType) || 'text',
          time: timeNow(),
          createdAt: new Date().toISOString(),
        } as ChatMessage,
      ],
    }))
  },

  addBudgetChatMessage: (msg) => {
    set((s) => ({
      budgetMessages: [
        ...s.budgetMessages,
        {
          ...msg,
          id: ++_id,
          role: (msg.role as ChatRole) || 'ai',
          type: (msg.type as ChatType) || 'text',
          time: timeNow(),
          createdAt: new Date().toISOString(),
        } as ChatMessage,
      ],
    }))
  },

  upsertBudgetGoal: (input) => {
    const title = String(input.title || '').trim() || '(목표)'
    const targetAmount = Math.max(0, Math.round(Number(input.targetAmount) || 0))
    const currentAmount = Math.max(0, Math.round(Number(input.currentAmount) || 0))
    const targetDate = String(input.targetDate || '').trim()
    const idKey = `${title.toLowerCase()}|${targetDate}`
    let created: BudgetGoalItem = {
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      targetAmount,
      currentAmount,
      targetDate,
      createdAt: new Date().toISOString(),
    }
    set((s) => {
      const idx = s.budgetGoals.findIndex(
        (g) => `${String(g.title || '').trim().toLowerCase()}|${String(g.targetDate || '').trim()}` === idKey,
      )
      if (idx < 0) {
        created = { ...created }
        return { budgetGoals: [created, ...s.budgetGoals] }
      }
      const prev = s.budgetGoals[idx]
      created = {
        ...prev,
        title,
        targetAmount,
        currentAmount,
        targetDate,
      }
      const next = [...s.budgetGoals]
      next[idx] = created
      return { budgetGoals: next }
    })
    void flushLocalVaultSnapshotToKv().catch(() => {})
    return created
  },

  addVaultChatMessage: (msg) => {
    set((s) => ({
      vaultMessages: [
        ...s.vaultMessages,
        {
          ...msg,
          id: ++_id,
          role: (msg.role as ChatRole) || 'ai',
          type: (msg.type as ChatType) || 'text',
          time: timeNow(),
          createdAt: new Date().toISOString(),
        } as ChatMessage,
      ],
    }))
  },

  resolveLedgerDeleteConfirmMessage: (messageId) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId && m.type === 'ledger_delete_confirm' ? { ...m, resolved: true } : m,
      ),
    }))
  },

  addSecretVaultDocument: (doc) => {
    const id =
      doc.id && String(doc.id).trim()
        ? String(doc.id).trim()
        : `sv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const row: SecretVaultDocument = {
      id,
      date: doc.date,
      title: doc.title,
      target: doc.target,
      expiry_date: doc.expiry_date,
      category: doc.category,
      memo: doc.memo,
    }
    set((s) => ({ secretVaultDocuments: [...s.secretVaultDocuments, row] }))
    return row
  },

  exportBackupSnapshot: () => {
    const state = get()
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      transactions: state.transactions,
      messages: state.messages,
      assetMessages: state.assetMessages,
      budgetMessages: state.budgetMessages,
      budgetGoals: state.budgetGoals,
      vaultMessages: state.vaultMessages,
      secretVaultDocuments: state.secretVaultDocuments,
      knownAccounts: state.knownAccounts,
      lastLedgerDecision: state.lastLedgerDecision,
      ledgerContextTitle: state.ledgerContextTitle,
      activeLedgerFilter: state.activeLedgerFilter,
      ledgerPeriodPreset: state.ledgerPeriodPreset,
      ledgerAccountFilter: state.ledgerAccountFilter,
      ledgerCategoryFilter: state.ledgerCategoryFilter,
      reviewPinnedTxIds: state.reviewPinnedTxIds,
    }
  },

  restoreFromBackupSnapshot: (snapshot) => {
    const transactions = Array.isArray(snapshot?.transactions) ? snapshot.transactions : []
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
    const assetMessages = Array.isArray(snapshot?.assetMessages) ? snapshot.assetMessages : []
    const budgetMessages = Array.isArray(snapshot?.budgetMessages) ? snapshot.budgetMessages : []
    const budgetGoals = Array.isArray(snapshot?.budgetGoals) ? snapshot.budgetGoals : []
    const vaultMessages = Array.isArray(snapshot?.vaultMessages) ? snapshot.vaultMessages : []
    const secretVaultDocuments = Array.isArray(snapshot?.secretVaultDocuments)
      ? snapshot.secretVaultDocuments
      : []
    const knownAccounts = Array.isArray(snapshot?.knownAccounts) ? snapshot.knownAccounts : []
    _id = computeNextInternalId(transactions, messages, assetMessages, budgetMessages, vaultMessages)

    set({
      transactions,
      messages,
      assetMessages,
      budgetMessages,
      budgetGoals,
      vaultMessages,
      secretVaultDocuments,
      knownAccounts,
      lastLedgerDecision: snapshot?.lastLedgerDecision || null,
      ledgerContextTitle: snapshot?.ledgerContextTitle || '데이터 원장 (전체)',
      activeLedgerFilter: snapshot?.activeLedgerFilter || 'all',
      ledgerPeriodPreset: normalizeLedgerPeriodPreset(snapshot?.ledgerPeriodPreset),
      ledgerAccountFilter:
        snapshot?.ledgerAccountFilter != null && String(snapshot.ledgerAccountFilter).trim()
          ? String(snapshot.ledgerAccountFilter).trim()
          : null,
      ledgerCategoryFilter: (() => {
        const raw = snapshot?.ledgerCategoryFilter
        if (raw === LEDGER_CATEGORY_FILTER_UNASSIGNED) return LEDGER_CATEGORY_FILTER_UNASSIGNED
        return raw != null && String(raw).trim() ? String(raw).trim() : null
      })(),
      reviewPinnedTxIds: Array.isArray(snapshot?.reviewPinnedTxIds) ? snapshot.reviewPinnedTxIds : [],
      hoveredTxId: null,
      isDragging: false,
      isProcessing: false,
    })
    void writeAllLedgerLines(transactions).catch((err) => {
      console.warn('[Vault] writeAllLedgerLines after restore', err)
    })
  },

  syncPendingFromBackgroundQueue: async () => {
    const queued = await drainBackgroundPendingQueue()
    console.info('[GmailDebug][Store] drain queue size:', queued.length)
    if (!queued.length) return 0
    const result = await get().ingestBackgroundParsedEntries(queued)
    return result.insertedCount
  },

  processDroppedFiles: async () => {
    set({ isProcessing: true, isDragging: false })

    set((s) => ({
      messages: [...s.messages, { id: ++_id, role: 'ai', type: 'processing', text: '', time: timeNow(), createdAt: new Date().toISOString() }],
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

    await putLedgerLinesBatch(newTxs)
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
          time: timeNow(), createdAt: new Date().toISOString(),
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
          time: timeNow(), createdAt: new Date().toISOString(),
        },
      ],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
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

    await putLedgerLine(newTx)
    const categoryLocked = hasMeaningfulCategory(newTx)
    set((s) => ({
      transactions: [newTx, ...s.transactions],
      messages: [
        ...s.messages,
        categoryLocked
          ? {
              id: ++_id,
              ...buildAccountClarifyMessage(newTx, s.knownAccounts, [newTx, ...s.transactions]),
              time: timeNow(), createdAt: new Date().toISOString(),
            }
          : {
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
              time: timeNow(), createdAt: new Date().toISOString(),
            },
      ],
    }))
    void flushLocalVaultSnapshotToKv().catch(() => {})

    return newTx.id
  },
}))

