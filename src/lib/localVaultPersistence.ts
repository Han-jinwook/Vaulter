import type { VaultBackupSnapshot } from '../stores/vaultStore'
import type { AssetLine } from '../types/assetLine'

const LOCAL_VAULT_DB = 'vaulter-local-vault'
const LOCAL_VAULT_STORE = 'kv'
const ASSETS_STORE = 'assets'
const KEY_VAULT_SNAPSHOT = 'vault_snapshot'

const DB_VERSION = 2

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_VAULT_DB, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(LOCAL_VAULT_STORE)) {
        db.createObjectStore(LOCAL_VAULT_STORE)
      }
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

export async function readLocalVaultSnapshot(): Promise<VaultBackupSnapshot | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_VAULT_STORE, 'readonly')
    const req = tx.objectStore(LOCAL_VAULT_STORE).get(KEY_VAULT_SNAPSHOT)
    req.onsuccess = () => resolve((req.result as VaultBackupSnapshot | null) || null)
    req.onerror = () => reject(req.error || new Error('로컬 원장 스냅샷을 읽지 못했습니다.'))
  })
}

export async function writeLocalVaultSnapshot(snapshot: VaultBackupSnapshot): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_VAULT_STORE, 'readwrite')
    tx.objectStore(LOCAL_VAULT_STORE).put(snapshot, KEY_VAULT_SNAPSHOT)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('로컬 원장 스냅샷을 저장하지 못했습니다.'))
  })
}

export async function clearLocalVaultSnapshot(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([LOCAL_VAULT_STORE, ASSETS_STORE], 'readwrite')
    tx.objectStore(LOCAL_VAULT_STORE).delete(KEY_VAULT_SNAPSHOT)
    if (db.objectStoreNames.contains(ASSETS_STORE)) {
      tx.objectStore(ASSETS_STORE).clear()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('로컬 원장 스냅샷을 삭제하지 못했습니다.'))
  })
}

// ── 황금자산 `assets` 오브젝트 스토어 (Dexie 대신 네이티브 IDB, 동일 DB 인스턴스) ──
// AssetLine: id, type, name, amount, asOfDate(YYYY-MM-DD), createdAt(ISO), memo?, history?[]
// 스키마는 객체 필드만 추가, DB_VERSION 변경 없이 하위 호환(ensure로 구버전 보정).

export async function readAllAssets(): Promise<AssetLine[]> {
  const db = await openDb()
  if (!db.objectStoreNames.contains(ASSETS_STORE)) return []
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readonly')
    const req = tx.objectStore(ASSETS_STORE).getAll()
    req.onsuccess = () => resolve((req.result as AssetLine[]) || [])
    req.onerror = () => reject(req.error || new Error('자산 목록을 읽지 못했습니다.'))
  })
}

export async function putAssetLine(row: AssetLine): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite')
    tx.objectStore(ASSETS_STORE).put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('자산을 저장하지 못했습니다.'))
  })
}

export async function deleteAssetLine(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite')
    tx.objectStore(ASSETS_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('자산을 삭제하지 못했습니다.'))
  })
}

/** 전체 교체 (복원·초기 시드) */
export async function writeAllAssetLines(lines: AssetLine[]): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, 'readwrite')
    const store = tx.objectStore(ASSETS_STORE)
    store.clear()
    for (const row of lines) {
      store.put(row)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('자산 목록을 덮어쓰지 못했습니다.'))
  })
}
