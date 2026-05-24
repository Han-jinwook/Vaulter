import { useEffect, useMemo, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'
import {
  downloadBackupById,
  getDriveBackupStatus,
  disconnectDriveBackupVault,
  listBackupFiles,
  uploadRotatedBackup,
  MAX_DATED_BACKUPS,
} from '../../lib/googleDriveSync'
import { clearStoredGmailAuth } from '../../lib/gmailSync'
import { buildFullBackupSnapshot, buildLocalKvSnapshot } from '../../lib/backupSnapshot'
import { writeLocalVaultSnapshot } from '../../lib/localVaultPersistence'
import { useAssetStore } from '../../stores/assetStore'
import WebhookSettings from './WebhookSettings'

function formatDateTime(timestamp) {
  if (!timestamp) return '아직 백업 기록 없음'
  const value = typeof timestamp === 'number' ? timestamp : Number(timestamp)
  if (!Number.isFinite(value)) return '아직 백업 기록 없음'
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SettingsModal() {
  const {
    closeSettingsModal,
    driveBackupConnected,
    driveBackupPhase,
    driveBackupStatus,
    lastDriveBackupAt,
    setDriveBackupState,
    setLastDriveBackupAt,
    setGmailConnectState,
    setGmailSyncState,
    setLastGmailSyncAt,
  } = useUIStore()
  const restoreFromBackupSnapshot = useVaultStore((s) => s.restoreFromBackupSnapshot)
  const [isBusy, setIsBusy] = useState(false)
  const [hasSnapshot, setHasSnapshot] = useState(false)
  const [backupHistory, setBackupHistory] = useState([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  const [showAllBackupHistory, setShowAllBackupHistory] = useState(false)
  const PREVIEW_BACKUP_COUNT = 2

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') closeSettingsModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeSettingsModal])

  useEffect(() => {
    let cancelled = false
    getDriveBackupStatus()
      .then((status) => {
        if (cancelled) return
        setHasSnapshot(status.hasSnapshot)
        setDriveBackupState(status.connected ? 'idle' : 'idle', '', status.connected)
        setLastDriveBackupAt(status.lastBackupAt)
        if (status.connected) {
          setIsLoadingHistory(true)
          return listBackupFiles()
            .then((files) => { if (!cancelled) setBackupHistory(files) })
            .catch(() => {})
            .finally(() => { if (!cancelled) setIsLoadingHistory(false) })
        }
      })
      .catch(() => {
        if (cancelled) return
        setHasSnapshot(false)
      })
    return () => {
      cancelled = true
    }
  }, [setDriveBackupState, setLastDriveBackupAt])

  const statusText = useMemo(() => {
    if (driveBackupStatus) return driveBackupStatus
    if (!driveBackupConnected) return '아직 개인 백업금고가 연결되지 않았습니다.'
    return hasSnapshot ? '개인 백업금고가 연결되어 상시 백업 준비가 완료되었습니다.' : '연결 완료. 첫 백업을 만들면 복원도 사용할 수 있습니다.'
  }, [driveBackupConnected, driveBackupStatus, hasSnapshot])

  const refreshHistory = async () => {
    setIsLoadingHistory(true)
    try {
      const files = await listBackupFiles()
      setBackupHistory(files)
    } catch {
      // silent
    } finally {
      setIsLoadingHistory(false)
    }
  }



  const handleRestoreFrom = async (fileId, label) => {
    if (isBusy || restoringId) return
    const confirmed = window.confirm(`"${label}" 백업으로 현재 로컬 원장을 덮어쓸까요?\n현재 상태는 복구되지 않습니다.`)
    if (!confirmed) return
    setRestoringId(fileId)
    setDriveBackupState('syncing', '백업 스냅샷을 내려받아 로컬에 복원하는 중...', driveBackupConnected)
    try {
      const snapshot = await downloadBackupById(fileId)
      restoreFromBackupSnapshot(snapshot)
      if (snapshot.goldenAssetLines !== undefined) {
        await useAssetStore.getState().hydrateFromSnapshot(snapshot.goldenAssetLines)
      } else {
        // 구버전 백업: 황금자산 필드 없음 → 부자산은 비움(원장만 복원)
        await useAssetStore.getState().hydrateFromSnapshot([])
      }
      await writeLocalVaultSnapshot(buildLocalKvSnapshot())
      setHasSnapshot(true)
      setDriveBackupState('success', `"${label}"으로 복원 완료`, true)
    } catch (error) {
      setDriveBackupState('error', error instanceof Error ? error.message : '복원 중 오류가 발생했습니다.', driveBackupConnected)
    } finally {
      setRestoringId(null)
    }
  }

  const handleDisconnect = async () => {
    if (isBusy) return
    const confirmed = window.confirm('Google 통합 연동을 해제할까요? 이후 Gmail 자동 수집과 Drive 자동 백업이 모두 중단됩니다.')
    if (!confirmed) return
    setIsBusy(true)
    try {
      await Promise.all([clearStoredGmailAuth(), disconnectDriveBackupVault()])
      setHasSnapshot(false)
      setDriveBackupState('idle', 'Google 통합 연동이 해제되었습니다.', false)
      setGmailConnectState('idle')
      setGmailSyncState('idle', '')
      setLastDriveBackupAt(null)
      setLastGmailSyncAt(null)
    } catch (error) {
      setDriveBackupState('error', error instanceof Error ? error.message : '연결 해제 중 오류가 발생했습니다.', driveBackupConnected)
    } finally {
      setIsBusy(false)
    }
  }

  const hasMoreBackups = backupHistory.length > PREVIEW_BACKUP_COUNT
  const historyRows = showAllBackupHistory
    ? backupHistory
    : backupHistory.slice(0, PREVIEW_BACKUP_COUNT)

  return (
    <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center overflow-y-auto px-4 py-4 sm:py-8">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeSettingsModal} />

      <div className="bg-surface-container-lowest w-full max-w-lg max-h-[min(92vh,900px)] rounded-xl shadow-2xl flex flex-col min-h-0 p-5 sm:p-6 relative z-10 my-auto">
        <button
          onClick={closeSettingsModal}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 text-outline hover:text-on-surface transition-colors z-20"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <div className="mb-4 sm:mb-5 shrink-0 pr-8">
          <h2 className="text-xl font-bold text-on-surface mb-1">설정</h2>
          <p className="text-sm text-on-surface-variant">
            로컬 원장을 본진으로 두고, Google Drive appData 숨김 공간을 개인 백업금고로 사용합니다.
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-0.5 custom-scrollbar">



        <div className="mb-4">
          <WebhookSettings />
        </div>

        <div className="rounded-2xl bg-surface-container-low p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-on-surface">Google 통합 연동</div>
              <div className="text-xs text-on-surface-variant mt-1">
                Gmail 읽기 권한과 Google Drive 숨김 백업금고 상태를 여기서 확인할 수 있습니다.
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${driveBackupConnected ? 'bg-primary/10 text-primary' : 'bg-surface text-on-surface-variant'}`}>
              {driveBackupConnected ? '연결됨' : '미연결'}
            </span>
          </div>

          <div className="rounded-xl bg-white px-4 py-3 border border-outline-variant/15">
            <div className="text-xs text-on-surface-variant">마지막 백업</div>
            <div className="mt-1 font-semibold text-sm text-on-surface">{formatDateTime(lastDriveBackupAt)}</div>
          </div>

          <div className={`rounded-xl px-4 py-3 text-sm ${driveBackupPhase === 'error' ? 'bg-red-50 text-red-700' : 'bg-primary/5 text-on-surface-variant'}`}>
            {statusText}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleDisconnect}
              disabled={isBusy || !driveBackupConnected}
              className="w-full bg-white text-on-surface py-3 px-4 rounded-xl font-bold border border-outline-variant/20 disabled:opacity-60 hover:bg-slate-50 transition-colors"
            >
              구글 드라이브 연결 해제
            </button>
          </div>
        </div>

        {driveBackupConnected && (
          <div className="mt-5 sm:mt-6 pb-1">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-bold text-on-surface">백업 히스토리</div>
              <button
                onClick={refreshHistory}
                disabled={isLoadingHistory}
                className="text-xs text-primary font-bold disabled:opacity-40 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                새로고침
              </button>
            </div>

            {isLoadingHistory ? (
              <div className="text-xs text-on-surface-variant py-4 text-center">히스토리 불러오는 중...</div>
            ) : backupHistory.length === 0 ? (
              <div className="text-xs text-on-surface-variant py-4 text-center">저장된 백업 파일이 없습니다.</div>
            ) : (
              <>
                <div
                  className={`rounded-xl border border-outline-variant/15 overflow-hidden ${
                    showAllBackupHistory
                      ? 'max-h-[min(40vh,320px)] overflow-y-auto custom-scrollbar'
                      : ''
                  }`}
                >
                  {historyRows.map((file, idx) => (
                    <div
                      key={file.id}
                      className={`flex items-center justify-between px-4 py-3 gap-3 ${idx !== 0 ? 'border-t border-outline-variant/10' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-on-surface truncate">{file.label}</div>
                        <div className="text-[11px] text-on-surface-variant mt-0.5">
                          {new Date(file.modifiedTime).toLocaleString('ko-KR', {
                            year: 'numeric', month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRestoreFrom(file.id, file.label)}
                        disabled={isBusy || restoringId === file.id}
                        className="shrink-0 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant text-xs font-bold disabled:opacity-40 hover:bg-surface-container-high transition-colors"
                      >
                        {restoringId === file.id ? '복원 중...' : '복원'}
                      </button>
                    </div>
                  ))}
                </div>
                {hasMoreBackups && (
                  <button
                    type="button"
                    onClick={() => setShowAllBackupHistory((v) => !v)}
                    className="mt-2 w-full py-2 text-center text-xs font-bold text-primary border border-primary/20 rounded-lg bg-primary/5 hover:bg-primary/10 transition-colors"
                  >
                    {showAllBackupHistory
                      ? '접기 (최근 2건만)'
                      : `히스토리 더 보기 (${backupHistory.length - PREVIEW_BACKUP_COUNT}개 더)`}
                  </button>
                )}
              </>
            )}
            <div className="text-[11px] text-on-surface-variant mt-2">
              최근 {MAX_DATED_BACKUPS}개 스냅샷을 보존합니다. 초기화 전 안전 백업도 여기에 표시됩니다.
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
