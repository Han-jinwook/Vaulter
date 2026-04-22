import { useEffect, useRef } from 'react'
import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import TopNavBar from './components/layout/TopNavBar'
import AIChatPanel from './components/chat/AIChatPanel'
import AssetChatPanel from './components/chat/AssetChatPanel'
import SettingsModal from './components/settings/SettingsModal'
import DashboardPage from './pages/DashboardPage'
import BudgetPage from './pages/BudgetPage'
import AssetsPage from './pages/AssetsPage'
import VaultPage from './pages/VaultPage'
import OnboardingPage from './pages/OnboardingPage'
import FileUploadOverlay from './components/upload/FileUploadOverlay'
import CreditChargeModal from './components/credit/CreditChargeModal'
import { getDriveBackupStatus, uploadRotatedBackup } from './lib/googleDriveSync'
import { buildFullBackupSnapshot } from './lib/backupSnapshot'
import { readLocalVaultSnapshot, writeLocalVaultSnapshot } from './lib/localVaultPersistence'
import { useUIStore } from './stores/uiStore'
import { useAssetStore } from './stores/assetStore'
import { useVaultStore } from './stores/vaultStore'

function toSnapshotKey(snapshot) {
  return JSON.stringify({ ...snapshot, exportedAt: '' })
}

const IDLE_MS = 30_000       // 마지막 변경 후 30초 idle → Drive 백업
const MAX_INTERVAL_MS = 5 * 60_000  // 5분 이상 지났으면 즉시 백업

function isNonEmpty(s) {
  return (
    (s?.transactions?.length ?? 0) > 0 ||
    (s?.messages?.length ?? 0) > 0 ||
    (s?.goldenAssetLines?.length ?? 0) > 0
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/vault" element={<VaultPage />} />
      </Route>
    </Routes>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  const {
    isUploadModalOpen,
    isCreditModalOpen,
    isSettingsModalOpen,
    isChatPanelOpen,
    setGmailSyncState,
    setLastGmailSyncAt,
    setDriveBackupState,
    setLastDriveBackupAt,
  } = useUIStore()
  const { isDragging, setDragging, ingestBackgroundParsedEntries, syncPendingFromBackgroundQueue } = useVaultStore()
  const dragCounter = useRef(0)
  const gmailStatusTimerRef = useRef(null)
  const backupPersistTimerRef = useRef(null)
  const lastAutoBackupAtRef = useRef(0)
  const pendingSnapshotRef = useRef(null)

  const doFlushBackup = async (snapshot) => {
    pendingSnapshotRef.current = null
    try {
      await writeLocalVaultSnapshot(snapshot)
    } catch (error) {
      console.warn('[VaultLocal] persist failed', error)
    }
    const { driveBackupConnected } = useUIStore.getState()
    if (!driveBackupConnected || !isNonEmpty(snapshot)) return
    try {
      setDriveBackupState('syncing', '개인 백업금고에 상시 백업 중...', true)
      const uploaded = await uploadRotatedBackup(snapshot)
      lastAutoBackupAtRef.current = Date.now()
      setLastDriveBackupAt(new Date(uploaded.modifiedTime).getTime())
      setDriveBackupState('success', '개인 백업금고 상시 백업 완료', true)
    } catch (error) {
      console.warn('[DriveBackup] auto backup failed', error)
      setDriveBackupState(
        'error',
        error instanceof Error ? error.message : '개인 백업금고 상시 백업 중 오류가 발생했습니다.',
        true,
      )
    }
  }

  const handleVisibilityHide = () => {
    if (document.visibilityState !== 'hidden') return
    const snapshot = pendingSnapshotRef.current
    if (!snapshot) return
    if (backupPersistTimerRef.current) {
      window.clearTimeout(backupPersistTimerRef.current)
      backupPersistTimerRef.current = null
    }
    doFlushBackup(snapshot)
  }

  useEffect(() => {
    const onEnter = (e) => {
      e.preventDefault()
      if (e.dataTransfer.types.includes('Files')) {
        dragCounter.current++
        if (dragCounter.current === 1) setDragging(true)
      }
    }
    const onLeave = (e) => {
      e.preventDefault()
      dragCounter.current--
      if (dragCounter.current <= 0) {
        dragCounter.current = 0
        setDragging(false)
      }
    }
    const onOver = (e) => e.preventDefault()
    const onDrop = (e) => {
      e.preventDefault()
      dragCounter.current = 0
    }

    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('dragover', onOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [setDragging])

  useEffect(() => {
    let cancelled = false
    let unsubscribe = () => {}

    const bootstrap = async () => {
      try {
        const localSnapshot = await readLocalVaultSnapshot()
        if (!cancelled) {
          if (localSnapshot?.version) {
            useVaultStore.getState().restoreFromBackupSnapshot(localSnapshot)
            await useAssetStore.getState().rehydrateAfterVaultSnapshotRead(localSnapshot.goldenAssetLines)
          } else {
            useVaultStore.getState().restoreFromBackupSnapshot({
              version: 1,
              exportedAt: new Date().toISOString(),
              transactions: [],
              messages: [],
              assetMessages: [],
              knownAccounts: [],
              lastLedgerDecision: null,
              ledgerContextTitle: '데이터 원장 (전체)',
              activeLedgerFilter: 'all',
              reviewPinnedTxIds: [],
              goldenAssetLines: [],
            })
            await useAssetStore.getState().loadAssets()
          }
        }
      } catch (error) {
        console.warn('[VaultLocal] bootstrap failed', error)
      }

      try {
        await syncPendingFromBackgroundQueue()
      } catch (error) {
        console.warn('[GmailSync] queue drain failed', error)
      }

      try {
        const status = await getDriveBackupStatus()
        if (!cancelled) {
          setDriveBackupState('idle', '', status.connected)
          setLastDriveBackupAt(status.lastBackupAt)
        }
      } catch (error) {
        console.warn('[DriveBackup] status bootstrap failed', error)
      }

      let lastSerialized = toSnapshotKey(buildFullBackupSnapshot())

      const pumpBackup = () => {
        const snapshot = buildFullBackupSnapshot()
        const serialized = toSnapshotKey(snapshot)
        if (serialized === lastSerialized) return
        lastSerialized = serialized

        pendingSnapshotRef.current = snapshot

        if (backupPersistTimerRef.current) {
          window.clearTimeout(backupPersistTimerRef.current)
        }

        const elapsed = Date.now() - lastAutoBackupAtRef.current
        const delay = elapsed > MAX_INTERVAL_MS ? 0 : IDLE_MS

        backupPersistTimerRef.current = window.setTimeout(() => {
          backupPersistTimerRef.current = null
          doFlushBackup(snapshot)
        }, delay)
      }

      const unsubVault = useVaultStore.subscribe(pumpBackup)
      const unsubAssets = useAssetStore.subscribe(pumpBackup)
      unsubscribe = () => {
        unsubVault()
        unsubAssets()
      }
    }

    bootstrap()
    document.addEventListener('visibilitychange', handleVisibilityHide)

    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityHide)
      if (backupPersistTimerRef.current) {
        window.clearTimeout(backupPersistTimerRef.current)
        backupPersistTimerRef.current = null
      }
    }
  }, [setDriveBackupState, setLastDriveBackupAt, syncPendingFromBackgroundQueue])

  useEffect(() => {
    const derivePhaseFromStatus = (text) => {
      if (!text) return 'idle'
      if (text.includes('권한') || text.includes('연결')) return 'connecting'
      if (text.includes('메일 읽는 중')) return 'reading'
      if (text.includes('분석 중') || text.includes('원장 반영')) return 'parsing'
      if (text.includes('완료') || text.includes('없음')) return 'success'
      if (text.includes('오류') || text.includes('실패') || text.includes('재연동')) return 'error'
      return 'reading'
    }

    const clearStatusTimer = () => {
      if (gmailStatusTimerRef.current) {
        window.clearTimeout(gmailStatusTimerRef.current)
        gmailStatusTimerRef.current = null
      }
    }

    const setTransientStatus = (text, ttlMs = 5000, phase = derivePhaseFromStatus(text)) => {
      clearStatusTimer()
      setGmailSyncState(phase, text)
      gmailStatusTimerRef.current = window.setTimeout(() => {
        setGmailSyncState('idle', '')
        gmailStatusTimerRef.current = null
      }, ttlMs)
    }

    const onSwMessage = (event) => {
      const type = event?.data?.type
      if (type === 'GMAIL_SYNC_PARSED') {
        const payload = event?.data?.payload
        const items = Array.isArray(payload) ? payload : payload?.items || []
        const incomingMeta = Array.isArray(payload?.meta) ? payload.meta : []
        console.info('[GmailDebug][App] SW parsed event items:', items.length, items.map((x) => x?.sourceMessageId))
        const result = ingestBackgroundParsedEntries(items)
        const insertedSourceRefs = new Set(result?.insertedSourceRefs || [])
        const mergedMeta = incomingMeta.map((meta) => ({
          ...meta,
          inserted: insertedSourceRefs.has(meta?.sourceMessageId),
        }))
        console.info('[GmailDebug][App] ingest result:', result)
        console.info('[GmailDebug][App] parsed meta:', mergedMeta)
        if (result.insertedCount > 0) {
          clearStatusTimer()
          setGmailSyncState('success', `원장 반영 완료 (+${result.insertedCount})`)
          setLastGmailSyncAt(Date.now())
        }
      }
      if (type === 'GMAIL_SYNC_STATUS') {
        const text = String(event?.data?.payload?.text || '')
        if (!text) {
          clearStatusTimer()
          setGmailSyncState('idle', '')
        } else if (text.includes('재연동 필요')) {
          clearStatusTimer()
          setGmailSyncState('error', text)
        } else if (text.includes('완료') || text.includes('없음')) {
          setTransientStatus(text, 5000, 'success')
          setLastGmailSyncAt(Date.now())
        } else {
          setTransientStatus(text, 12000, derivePhaseFromStatus(text))
        }
      }
      if (type === 'GMAIL_SYNC_ERROR') {
        const payload = event?.data?.payload
        const normalized =
          payload && typeof payload === 'object'
            ? payload
            : { kind: 'sync_failed', message: String(payload || 'Gmail 동기화 오류') }
        console.warn('[GmailSync] service worker error:', normalized)
        if (normalized.kind === 'parse_failed') {
          return
        }
        setTransientStatus(String(normalized.message || 'Gmail 동기화 오류'), 8000, 'error')
      }
      if (type === 'GMAIL_SYNC_AUTH_EXPIRED') {
        console.info('[GmailSync] auth expired; reconnect Gmail is required')
        clearStatusTimer()
        setGmailSyncState('error', 'Gmail 재연동 필요')
      }
    }

    navigator.serviceWorker?.addEventListener('message', onSwMessage)

    return () => {
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
      clearStatusTimer()
    }
  }, [ingestBackgroundParsedEntries, setGmailSyncState, setLastGmailSyncAt])

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <TopNavBar />
      <main className="max-w-[1440px] mx-auto px-4 md:px-4 pb-8 flex gap-3 items-start min-h-[calc(100vh-6.75rem)] md:min-h-[calc(100vh-5rem)]">
        <div className="flex-grow min-w-0 flex flex-col gap-6">
          <Outlet />
        </div>
        <div
          className={
            pathname === '/assets'
              ? 'w-1.5 self-stretch rounded-full hidden lg:block shrink-0 bg-gradient-to-b from-amber-200/50 to-amber-100/30 border border-amber-300/40'
              : 'w-1.5 self-stretch bg-surface-container rounded-full hidden lg:block shrink-0'
          }
        />
        {isChatPanelOpen &&
          (pathname === '/assets' ? <AssetChatPanel /> : <AIChatPanel />)}
      </main>

      {(isUploadModalOpen || isDragging) && <FileUploadOverlay />}
      {isCreditModalOpen && <CreditChargeModal />}
      {isSettingsModalOpen && <SettingsModal />}
    </div>
  )
}
