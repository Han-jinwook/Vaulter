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
  const { isUploadModalOpen, isCreditModalOpen, isChatPanelOpen } = useUIStore()
  const { isDragging, setDragging } = useVaultStore()
  const dragCounter = useRef(0)

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

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <TopNavBar />
      <main className="max-w-[1440px] mx-auto px-4 md:px-8 pb-8 flex gap-6 h-[calc(100vh-6.75rem)] md:h-[calc(100vh-5rem)] overflow-hidden">
        <div className="flex-grow flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          <Outlet />
        </div>
        <div className="w-1.5 bg-surface-container hover:bg-primary/30 rounded-full hidden lg:block cursor-col-resize transition-colors shrink-0" />
        {isChatPanelOpen && <AIChatPanel />}
      </main>

      {(isUploadModalOpen || isDragging) && <FileUploadOverlay />}
      {isCreditModalOpen && <CreditChargeModal />}
    </div>
  )
}
