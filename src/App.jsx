import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { useHub, HubBenefitModal } from './services/merlin-hub-sdk/react'
import TopNavBar from './components/layout/TopNavBar'
import AIChatPanel from './components/chat/AIChatPanel'
import AssetChatPanel from './components/chat/AssetChatPanel'
import VaultChatPanel from './components/chat/VaultChatPanel'
import SettingsModal from './components/settings/SettingsModal'
import DashboardPage from './pages/DashboardPage'
import AssetsPage from './pages/AssetsPage'
import VaultPage from './pages/VaultPage'
import SettingsPage from './pages/SettingsPage'
import OnboardingPage from './pages/OnboardingPage'
import WalletPage from './pages/WalletPage'
import FileUploadOverlay from './components/upload/FileUploadOverlay'
import GoogleConnectModal from './components/google/GoogleConnectModal'
import { getDriveBackupStatus, uploadRotatedBackup } from './lib/googleDriveSync'
import { buildFullBackupSnapshot, buildLocalKvSnapshot } from './lib/backupSnapshot'
import { readLocalVaultSnapshot, writeLocalVaultSnapshot } from './lib/localVaultPersistence'
import { resolveTransactionsForLoad } from './lib/ledgerBootstrap'
import { useUIStore } from './stores/uiStore'
import { useAssetStore } from './stores/assetStore'
import { useVaultStore } from './stores/vaultStore'
import { registerAndSyncWebhookInbox } from './lib/syncWebhookInbox'

function toSnapshotKey(snapshot) {
  return JSON.stringify({ ...snapshot, exportedAt: '' })
}

const IDLE_MS = 30_000       // 마지막 변경 후 30초 idle → Drive 백업
const MAX_INTERVAL_MS = 5 * 60_000  // 5분 이상 지났으면 즉시 백업

function isNonEmpty(s) {
  return (
    (s?.transactions?.length ?? 0) > 0 ||
    (s?.messages?.length ?? 0) > 0 ||
    (s?.assetMessages?.length ?? 0) > 0 ||
    (s?.vaultMessages?.length ?? 0) > 0 ||
    (s?.secretVaultDocuments?.length ?? 0) > 0 ||
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
        <Route path="/vault" element={<VaultPage />} />
        <Route path="/p-settings" element={<SettingsPage />} />
        <Route path="/p-wallet" element={<WalletPage />} />
      </Route>
    </Routes>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  const { isLoggedIn, isLoading: isHubLoading } = useHub()
  const [isBackupStatusLoaded, setIsBackupStatusLoaded] = useState(false)
  const {
    isUploadModalOpen,
    isSettingsModalOpen,
    isGoogleConnectModalOpen,
    closeGoogleConnectModal,
    openGoogleConnectModal,
    driveBackupConnected,
    isChatPanelOpen,
    setGmailSyncState,
    setLastGmailSyncAt,
    setDriveBackupState,
    setLastDriveBackupAt,
  } = useUIStore()
  const {
    isDragging,
    setDragging,
    ingestBackgroundParsedEntries,
    syncPendingFromBackgroundQueue,
  } = useVaultStore()
  const dragCounter = useRef(0)
  const gmailStatusTimerRef = useRef(null)
  const backupPersistTimerRef = useRef(null)
  const lastAutoBackupAtRef = useRef(0)
  const pendingSnapshotRef = useRef(null)

  const doFlushBackup = async (snapshot) => {
    pendingSnapshotRef.current = null
    try {
      await writeLocalVaultSnapshot(buildLocalKvSnapshot())
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
        const transactions = await resolveTransactionsForLoad(localSnapshot)
        if (!cancelled) {
          if (localSnapshot?.version) {
            useVaultStore.getState().restoreFromBackupSnapshot({ ...localSnapshot, transactions })
            await useAssetStore.getState().rehydrateAfterVaultSnapshotRead(localSnapshot.goldenAssetLines)
          } else {
            useVaultStore.getState().restoreFromBackupSnapshot({
              version: 1,
              exportedAt: new Date().toISOString(),
              transactions,
              messages: [],
              assetMessages: [],
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
        const wh = await registerAndSyncWebhookInbox()
        if (wh.ok && wh.pulled > 0) {
          console.info('[WebhookInbox] merged', wh.pulled)
        }
      } catch (error) {
        console.warn('[WebhookInbox] sync failed', error)
      }

      try {
        const status = await getDriveBackupStatus()
        if (!cancelled) {
          setDriveBackupState('idle', '', status.connected)
          setLastDriveBackupAt(status.lastBackupAt)
          
          if (status.connected) {
            const cachedEmail = localStorage.getItem('vaulter_google_connected_email')
            if (cachedEmail) {
              useUIStore.getState().setConnectedEmail(cachedEmail)
            }
            const { fetchConnectedEmail } = await import('./lib/googleIntegration')
            const email = await fetchConnectedEmail()
            if (email && !cancelled) {
              useUIStore.getState().setConnectedEmail(email)
              localStorage.setItem('vaulter_google_connected_email', email)
            }
          }
        }
      } catch (error) {
        console.warn('[DriveBackup] status bootstrap failed', error)
      } finally {
        if (!cancelled) {
          setIsBackupStatusLoaded(true)
        }
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
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void registerAndSyncWebhookInbox().then((r) => {
        if (r.ok && r.pulled > 0) {
          console.info('[WebhookInbox] visibility merge', r.pulled)
        }
      })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // 30분 버퍼형 세션 타이머 및 마운트 시 기동 플러시 제어
  useEffect(() => {
    const userId = localStorage.getItem('merlin_user_id') || localStorage.getItem('merlin_family_uid')
    if (!userId) return

    const flushBillingSession = async () => {
      try {
        const res = await fetch('/api/session-billing/flush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        })
        const data = await res.json()
        if (data.ok && data.price > 0) {
          console.info('[SessionBilling] 30분 무활동 세션 통합 정산 완료. 차감액:', data.price, '남은 잔액:', data.balance)
        }
      } catch (err) {
        console.error('[SessionBilling] 세션 정산 실패:', err)
      }
    }

    // 1. 기동 시점 체크: 이전 활동 기준 30분이 넘었으면 즉시 플러시
    const lastActiveStr = localStorage.getItem('vaulter_billing_last_active')
    if (lastActiveStr) {
      const elapsed = Date.now() - Number(lastActiveStr)
      if (elapsed >= 30 * 60 * 1000) {
        flushBillingSession()
      }
    }

    // 2. 무활동 30분 감시 타이머 루프
    let timerId = setInterval(() => {
      const activeStr = localStorage.getItem('vaulter_billing_last_active')
      if (activeStr) {
        const elapsed = Date.now() - Number(activeStr)
        if (elapsed >= 30 * 60 * 1000) {
          // 30분 초과 시 즉시 플러시 진행 후 기록 초기화
          localStorage.removeItem('vaulter_billing_last_active')
          flushBillingSession()
        }
      }
    }, 30_000) // 30초마다 검사

    // 3. AI 액션 수행 시 수신할 이벤트 핸들러 등록
    const handleActiveAction = () => {
      localStorage.setItem('vaulter_billing_last_active', String(Date.now()))
    };

    window.addEventListener('vaulterActiveSessionAction', handleActiveAction)

    return () => {
      clearInterval(timerId)
      window.removeEventListener('vaulterActiveSessionAction', handleActiveAction)
    }
  }, [])

  useEffect(() => {
    if (isHubLoading || !isBackupStatusLoaded) return

    if (isLoggedIn && !driveBackupConnected) {
      const shownThisSession = sessionStorage.getItem('vaulter_google_prompt_shown')
      if (shownThisSession !== 'true') {
        openGoogleConnectModal()
        sessionStorage.setItem('vaulter_google_prompt_shown', 'true')
      }
    }
  }, [isLoggedIn, isHubLoading, isBackupStatusLoaded, driveBackupConnected, openGoogleConnectModal])

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

    const onSwMessage = async (event) => {
      const type = event?.data?.type
      if (type === 'GMAIL_SYNC_PARSED') {
        const payload = event?.data?.payload
        const items = Array.isArray(payload) ? payload : payload?.items || []
        const incomingMeta = Array.isArray(payload?.meta) ? payload.meta : []
        console.info('[GmailDebug][App] SW parsed event items:', items.length, items.map((x) => x?.sourceMessageId))
        const result = await ingestBackgroundParsedEntries(items)
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
        {pathname !== '/p-settings' && pathname !== '/p-wallet' && (
          <div
            className={
              pathname === '/assets'
                ? 'w-1.5 self-stretch rounded-full hidden lg:block shrink-0 bg-gradient-to-b from-amber-200/50 to-amber-100/30 border border-amber-300/40'
                : pathname === '/vault'
                    ? 'w-1.5 self-stretch rounded-full hidden lg:block shrink-0 bg-gradient-to-b from-slate-600/50 to-slate-800/50 border border-slate-500/50'
                    : 'w-1.5 self-stretch bg-surface-container rounded-full hidden lg:block shrink-0'
            }
          />
        )}
        {isChatPanelOpen && pathname !== '/p-settings' && pathname !== '/p-wallet' &&
          (pathname === '/assets' ? (
            <AssetChatPanel />
          ) : pathname === '/vault' ? (
            <VaultChatPanel />
          ) : (
            <AIChatPanel />
          ))}
      </main>

      {(isUploadModalOpen || isDragging) && <FileUploadOverlay />}
      {isSettingsModalOpen && <SettingsModal />}
      {isGoogleConnectModalOpen && (
        <GoogleConnectModal
          isOpen={isGoogleConnectModalOpen}
          onClose={closeGoogleConnectModal}
          onConnected={() => {
            closeGoogleConnectModal()
          }}
        />
      )}
      <HubBenefitModal
        customBenefitTitle="실시간 재무 분석 & 자산 추적"
        customBenefitDesc="가계부 원장과 계정 상태 분석, 자산 포트폴리오를 실시간 동기화"
        customBenefitIcon="📊"
      />
    </div>
  )
}
