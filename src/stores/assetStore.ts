import { create } from 'zustand'
import type { AssetLine, AssetLineType, AssetHistoryEntry } from '../types/assetLine'
import {
  readAllAssets,
  putAssetLine,
  deleteAssetLine,
  writeAllAssetLines,
} from '../lib/localVaultPersistence'
import { flushLocalVaultSnapshotToKv } from '../lib/flushLocalVaultSnapshot'
import { coerceToYmd, isValidYmd, todayYmdLocal, ymdToIsoStartUtc } from '../lib/ymdDate'
import { normalizeCategoryForType } from '../lib/goldenAssetCategories'

function newId() {
  return `ga_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** 예전 데모 시드에 쓰던 id — 로드 시 제거(채팅/사용자 등록은 `ga_` id) */
const LEGACY_DEMO_IDS = new Set(['a1', 'a2', 'a3', 'd1'])

function formatWon(n: number) {
  return `₩${n.toLocaleString('ko-KR')}`
}

function normalizeHistoryEntry(e: AssetHistoryEntry): AssetHistoryEntry {
  return { ...e, date: coerceToYmd(e.date) }
}

/** IDB/백업: history·asOfDate 보정 (구버전은 createdAt/ISO에서 복원) */
function ensureAssetLineShape(l: AssetLine | (Partial<AssetLine> & { id: string })): AssetLine {
  const row = l as AssetLine
  const hRaw = Array.isArray(row.history) ? row.history : []
  const h = hRaw.map(normalizeHistoryEntry)
  let asOfDate = row.asOfDate
  if (!asOfDate || !isValidYmd(asOfDate)) {
    asOfDate =
      row.createdAt && row.createdAt.length >= 10 ? coerceToYmd(row.createdAt) : todayYmdLocal()
  }
  if (!isValidYmd(asOfDate)) asOfDate = todayYmdLocal()
  const category = normalizeCategoryForType(row.type, row.category)
  return {
    ...row,
    asOfDate,
    history: h,
    category,
  }
}

function categoryMigrationDirty(raw: AssetLine[], normalized: AssetLine[]): boolean {
  const m = new Map(raw.map((r) => [r.id, r]))
  return normalized.some(
    (l) => l.category !== (m.get(l.id) as AssetLine | undefined)?.category,
  )
}

function mapLinesShape(lines: AssetLine[]) {
  return lines.map(ensureAssetLineShape)
}

/**
 * `assets` 오브젝트 스토어(즉시 쓰기)와 vault KV `goldenAssetLines`(늦게 flush)를 합침.
 * id 충돌 시 IDB 쪽이 이김(채팅 CRUD는 assets에만 먼저 있을 수 있음).
 */
function mergeIdbWithVaultSnapshotLinesRaw(
  idb: AssetLine[],
  vaultLines: AssetLine[] | undefined,
): AssetLine[] {
  const v = Array.isArray(vaultLines) ? vaultLines : []
  const m = new Map<string, AssetLine>()
  for (const l of v) {
    if (LEGACY_DEMO_IDS.has(l.id)) continue
    m.set(l.id, l)
  }
  for (const l of idb) {
    if (LEGACY_DEMO_IDS.has(l.id)) continue
    m.set(l.id, l)
  }
  return [...m.values()]
}

type AssetPatch = Partial<Pick<AssetLine, 'type' | 'category' | 'name' | 'amount' | 'memo' | 'asOfDate'>>

type AddAssetInput = Omit<AssetLine, 'id' | 'createdAt' | 'history'>

type AssetState = {
  lines: AssetLine[]
  /** IndexedDB에서 초기 로드 완료 여부 */
  hydrated: boolean
  /** IDB → 메모리 (데모 시드 없음) */
  loadAssets: () => Promise<void>
  /**
   * 앱 기동: vault KV에 들어온 `goldenAssetLines`와 `assets` IDB를 merge 후 저장.
   * (KV만 비어 있고 IDB엔 이미 `put`돼 있던 자산 — 예: debounce 전 탭 닫힘)
   */
  rehydrateAfterVaultSnapshotRead: (goldenFromVault: AssetLine[] | undefined) => Promise<void>
  /** 백업 복원 등: 배열 그대로 IDB 덮어쓰기 */
  hydrateFromSnapshot: (lines: AssetLine[] | undefined) => Promise<void>
  addAsset: (row: AddAssetInput) => Promise<void>
  updateAsset: (id: string, patch: AssetPatch) => Promise<void>
  deleteAsset: (id: string) => Promise<void>
  /** 전체 초기화 등 */
  resetToEmpty: () => Promise<void>
}

export const useAssetStore = create<AssetState>((set, get) => ({
  lines: [],
  hydrated: false,

  rehydrateAfterVaultSnapshotRead: async (goldenFromVault) => {
    const fromIdbRaw = await readAllAssets()
    if (goldenFromVault === undefined) {
      const fromIdb = mapLinesShape(fromIdbRaw)
      const rows = fromIdb.filter((l) => !LEGACY_DEMO_IDS.has(l.id))
      const rawNoLegacy = fromIdbRaw.filter((l) => !LEGACY_DEMO_IDS.has(l.id))
      if (rows.length !== rawNoLegacy.length) {
        await writeAllAssetLines(rows)
      } else if (categoryMigrationDirty(rawNoLegacy, rows)) {
        await writeAllAssetLines(rows)
      }
      set({ lines: rows, hydrated: true })
      return
    }
    const mergedRaw = mergeIdbWithVaultSnapshotLinesRaw(fromIdbRaw, goldenFromVault)
    const merged = mapLinesShape(mergedRaw).filter((l) => !LEGACY_DEMO_IDS.has(l.id))
    await writeAllAssetLines(merged)
    set({ lines: merged, hydrated: true })
    try {
      await flushLocalVaultSnapshotToKv()
    } catch {
      // kv 실패해도 idb+메모리는 맞음
    }
  },

  loadAssets: async () => {
    const raw = await readAllAssets()
    let rows = mapLinesShape(raw)
    const withoutLegacy = rows.filter((l) => !LEGACY_DEMO_IDS.has(l.id))
    if (withoutLegacy.length !== rows.length) {
      await writeAllAssetLines(withoutLegacy)
      rows = withoutLegacy
    } else if (categoryMigrationDirty(raw, rows)) {
      await writeAllAssetLines(rows)
    }
    set({ lines: rows, hydrated: true })
  },

  hydrateFromSnapshot: async (lines) => {
    if (!Array.isArray(lines)) {
      await get().loadAssets()
      return
    }
    const cleaned = mapLinesShape(lines).filter((l) => !LEGACY_DEMO_IDS.has(l.id))
    await writeAllAssetLines(cleaned)
    set({ lines: [...cleaned], hydrated: true })
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  addAsset: async (row) => {
    const cleanMemo = typeof row.memo === 'string' && row.memo.trim() ? row.memo.trim() : undefined
    const asOf = isValidYmd(row.asOfDate) ? row.asOfDate : coerceToYmd(row.asOfDate)
    const amount = row.amount
    const initialEntry: AssetHistoryEntry = {
      date: asOf,
      amount,
      memo: cleanMemo || '최초 등록',
    }
    const createdAt = ymdToIsoStartUtc(asOf)
    const next: AssetLine = {
      type: row.type,
      category: normalizeCategoryForType(row.type, row.category),
      name: row.name,
      amount,
      asOfDate: asOf,
      createdAt,
      id: newId(),
      memo: cleanMemo,
      history: [initialEntry],
    }
    await putAssetLine(next)
    set((s) => ({ lines: [...s.lines, next] }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  updateAsset: async (id, patch) => {
    const prev = get().lines.find((l) => l.id === id)
    if (!prev) return

    const prevH = Array.isArray(prev.history) ? [...prev.history] : []
    const newAmount = patch.amount !== undefined ? Math.max(0, Math.round(Number(patch.amount))) : prev.amount
    const newMemoFromPatch =
      patch.memo !== undefined ? (String(patch.memo).trim() || undefined) : undefined
    const newMemo = patch.memo !== undefined ? newMemoFromPatch : prev.memo

    const amountChanged = patch.amount !== undefined && newAmount !== prev.amount
    const memoChanged = patch.memo !== undefined && (newMemo || '') !== (prev.memo || '')

    const asOfForChange =
      patch.asOfDate != null && isValidYmd(String(patch.asOfDate).trim())
        ? String(patch.asOfDate).trim()
        : todayYmdLocal()

    const next: AssetLine = { ...prev, amount: newAmount, memo: newMemo, history: prevH }
    if (patch.type != null) next.type = patch.type
    if (patch.category != null) next.category = normalizeCategoryForType(next.type, String(patch.category))
    if (patch.name != null) next.name = String(patch.name)
    if (patch.type != null && patch.category == null) {
      next.category = normalizeCategoryForType(next.type, next.category)
    }

    if (amountChanged || memoChanged) {
      const parts: string[] = []
      if (amountChanged) parts.push(`금액 ${formatWon(prev.amount)} → ${formatWon(newAmount)}`)
      if (memoChanged) {
        if (newMemo) parts.push(`메모: ${newMemo}`)
        else parts.push('메모 삭제')
      }
      next.asOfDate = asOfForChange
      next.history = [
        ...prevH,
        {
          date: asOfForChange,
          amount: newAmount,
          memo: parts.join(' · '),
        },
      ]
    }

    await putAssetLine(next)
    set((s) => ({ lines: s.lines.map((l) => (l.id === id ? next : l)) }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  deleteAsset: async (id) => {
    await deleteAssetLine(id)
    set((s) => ({ lines: s.lines.filter((l) => l.id !== id) }))
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },

  resetToEmpty: async () => {
    await writeAllAssetLines([])
    set({ lines: [], hydrated: true })
    void flushLocalVaultSnapshotToKv().catch(() => {})
  },
}))

export function selectAssetLines(lines: AssetLine[], type: AssetLineType) {
  return lines.filter((l) => l.type === type)
}

export function sumByCategory(lines: AssetLine[], type: AssetLineType) {
  const map = new Map<string, number>()
  for (const l of lines) {
    if (l.type !== type) continue
    map.set(l.category, (map.get(l.category) ?? 0) + l.amount)
  }
  return map
}

// 타입 재export (기존 import 경로 호환)
export type { AssetLine, AssetLineType, AssetHistoryEntry } from '../types/assetLine'
