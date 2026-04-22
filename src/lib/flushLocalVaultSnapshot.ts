import { buildFullBackupSnapshot } from './backupSnapshot'
import { writeLocalVaultSnapshot } from './localVaultPersistence'

/** 원장+황금자산이 합쳐진 JSON을 KV에 즉시 씀 (채팅 자산 CRUD 직후 스냅샷 늦음으로 인한 불일치 방지) */
export function flushLocalVaultSnapshotToKv(): Promise<void> {
  return writeLocalVaultSnapshot(buildFullBackupSnapshot())
}
