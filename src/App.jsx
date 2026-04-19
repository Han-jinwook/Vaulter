import { useEffect, useRef } from 'react'
import { Routes, Route, Outlet } from 'react-router-dom'
import TopNavBar from './components/layout/TopNavBar'
import AIChatPanel from './components/chat/AIChatPanel'
import DashboardPage from './pages/DashboardPage'
import BudgetPage from './pages/BudgetPage'
import AssetsPage from './pages/AssetsPage'
import VaultPage from './pages/VaultPage'
import OnboardingPage from './pages/OnboardingPage'
import FileUploadOverlay from './components/upload/FileUploadOverlay'
import CreditChargeModal from './components/credit/CreditChargeModal'
import { useUIStore } from './stores/uiStore'
import { useVaultStore } from './stores/vaultStore'

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
  const {
    isUploadModalOpen,
    isCreditModalOpen,
    isChatPanelOpen,
    setGmailSyncState,
    setLastGmailSyncAt,
  } = useUIStore()
  const { isDragging, setDragging, ingestBackgroundParsedEntries, syncPendingFromBackgroundQueue } = useVaultStore()
  const dragCounter = useRef(0)
  const gmailStatusTimerRef = useRef(null)

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
    syncPendingFromBackgroundQueue().catch((error) => {
      console.warn('[GmailSync] queue drain failed', error)
    })
  }, [syncPendingFromBackgroundQueue])

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
      <main className="max-w-[1440px] mx-auto px-4 md:px-8 pb-8 flex gap-6 items-start min-h-[calc(100vh-6.75rem)] md:min-h-[calc(100vh-5rem)]">
        <div className="flex-grow min-w-0 flex flex-col gap-6 pr-2">
          <Outlet />
        </div>
        <div className="w-1.5 self-stretch bg-surface-container hover:bg-primary/30 rounded-full hidden lg:block cursor-col-resize transition-colors shrink-0" />
        {isChatPanelOpen && <AIChatPanel />}
      </main>

      {(isUploadModalOpen || isDragging) && <FileUploadOverlay />}
      {isCreditModalOpen && <CreditChargeModal />}
    </div>
  )
}
