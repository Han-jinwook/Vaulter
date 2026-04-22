import { useVaultStore } from '../stores/vaultStore'
import { useAssetStore } from '../stores/assetStore'
import type { VaultBackupSnapshot } from '../stores/vaultStore'

/** Drive / 로컬 JSON 백업용: 원장 스냅샷 + 황금자산 라인 */
export function buildFullBackupSnapshot(): VaultBackupSnapshot {
  const base = useVaultStore.getState().exportBackupSnapshot()
  return {
    ...base,
    goldenAssetLines: useAssetStore.getState().lines,
  }
}
