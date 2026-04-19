import type { VaultBackupSnapshot } from '../stores/vaultStore'

const LOCAL_VAULT_DB = 'vaulter-local-vault'
const LOCAL_VAULT_STORE = 'kv'
const KEY_VAULT_SNAPSHOT = 'vault_snapshot'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_VAULT_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(LOCAL_VAULT_STORE)) {
        db.createObjectStore(LOCAL_VAULT_STORE)
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
    const tx = db.transaction(LOCAL_VAULT_STORE, 'readwrite')
    tx.objectStore(LOCAL_VAULT_STORE).delete(KEY_VAULT_SNAPSHOT)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('로컬 원장 스냅샷을 삭제하지 못했습니다.'))
  })
}
