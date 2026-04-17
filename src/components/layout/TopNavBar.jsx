import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import {
  clearGmailSyncTestData,
  connectGmailReadonly,
  setDigestHourPreference,
  validateGmailReadonlyAccess,
} from '../../lib/gmailSync'

const navItems = [
  { path: '/', desktopLabel: '지기(Keeper)', mobileLabel: '지기' },
  { path: '/assets', desktopLabel: '황금자산', mobileLabel: '자산' },
  { path: '/budget', desktopLabel: '예산&목표', mobileLabel: '예산목표' },
  { path: '/vault', desktopLabel: '비밀금고', mobileLabel: '금고' },
]

export default function TopNavBar() {
  const location = useLocation()
  const {
    openCreditModal,
    gmailSyncPhase,
    gmailSyncStatus,
    lastGmailSyncAt,
    setGmailSyncState,
    setLastGmailSyncAt,
  } = useUIStore()
  const [isConnectingGmail, setIsConnectingGmail] = useState(false)
  const [isClearingGmail, setIsClearingGmail] = useState(false)
  const isActive = (path) => location.pathname === path

  const phaseFallbackLabel = {
    idle: 'Gmail 연동',
    connecting: 'Gmail 연결 중...',
    reading: '메일 읽는 중...',
    parsing: '메일 분석 중...',
    success: '동기화 완료',
    error: '동기화 오류',
  }

  const formatLastSync = (timestamp) => {
    if (!timestamp) return '마지막 동기화 없음'
    const value = typeof timestamp === 'number' ? timestamp : Number(timestamp)
    if (!Number.isFinite(value)) return '마지막 동기화 없음'
    return `마지막 동기화 ${new Date(value).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }

  const withTimeout = (promise, ms, message) =>
    new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(message)), ms)
      promise
        .then((value) => {
          window.clearTimeout(timer)
          resolve(value)
        })
        .catch((error) => {
          window.clearTimeout(timer)
          reject(error)
        })
    })

  useEffect(() => {
    if (gmailSyncPhase !== 'connecting') return
    const timer = window.setTimeout(() => {
      // OAuth callback 누락/브라우저 권한 팝업 이슈로 상태가 고정될 수 있어 자동 복구한다.
      setGmailSyncState('idle', '')
      setIsConnectingGmail(false)
    }, 35000)
    return () => window.clearTimeout(timer)
  }, [gmailSyncPhase, setGmailSyncState])

  const handleConnectGmail = async () => {
    if (isConnectingGmail) return
    setIsConnectingGmail(true)
    setGmailSyncState('connecting', 'Gmail 연결 중...')
    try {
      setGmailSyncState('connecting', '권한 요청 중...')
      const token = await withTimeout(
        connectGmailReadonly(),
        30000,
        'Gmail 연동 시간이 초과되었습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'
      )
      setGmailSyncState('connecting', '연결 확인 중...')
      await validateGmailReadonlyAccess(token.accessToken)
      await setDigestHourPreference(20)
      if (Notification.permission === 'default') {
        await Notification.requestPermission()
      }
      const registration = await navigator.serviceWorker?.ready
      registration?.active?.postMessage({ type: 'SET_GMAIL_DIGEST_HOUR', payload: 20 })
      registration?.active?.postMessage({ type: 'GMAIL_SYNC_TICK' })
      setGmailSyncState('reading', '메일 읽는 중...')
      window.setTimeout(() => {
        setGmailSyncState('idle', '')
      }, 15000)
      window.alert('Gmail 읽기 전용 연동이 완료되었습니다. 이제 결제 메일을 조용히 정리합니다.')
    } catch (error) {
      setGmailSyncState('error', 'Gmail 연동 실패')
      window.alert(error instanceof Error ? error.message : 'Gmail 연동 중 오류가 발생했습니다.')
    } finally {
      setIsConnectingGmail(false)
    }
  }

  const handleResetGmailTestData = async () => {
    if (isClearingGmail) return
    const ok = window.confirm(
      'Gmail 테스트 기록(읽은 메일 ID/일일 카운트/대기 큐)을 초기화할까요?\nOAuth 연동 정보는 유지됩니다.'
    )
    if (!ok) return

    setIsClearingGmail(true)
    setGmailSyncState('parsing', 'Gmail 기록 초기화 중...')
    try {
      await clearGmailSyncTestData(true)
      setLastGmailSyncAt(null)
      setGmailSyncState('success', 'Gmail 테스트 기록 초기화 완료')
      window.alert('Gmail 테스트 기록 초기화가 완료되었습니다. 마지막 동기화 시각도 초기화되었습니다.')
      // Do not block UI on service worker readiness.
      const triggerSync = async () => {
        const controller = navigator.serviceWorker?.controller
        if (controller) {
          controller.postMessage({ type: 'GMAIL_SYNC_TICK' })
          return
        }
        try {
          const registration = await Promise.race([
            navigator.serviceWorker?.ready ?? Promise.resolve(null),
            new Promise((resolve) => window.setTimeout(() => resolve(null), 1200)),
          ])
          registration?.active?.postMessage({ type: 'GMAIL_SYNC_TICK' })
        } catch {
          // ignore background sync trigger failure
        }
      }
      void triggerSync()
    } catch (error) {
      setGmailSyncState('error', 'Gmail 기록 초기화 실패')
      window.alert(error instanceof Error ? error.message : 'Gmail 기록 초기화 중 오류가 발생했습니다.')
    } finally {
      setIsClearingGmail(false)
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="w-full max-w-[1440px] mx-auto">
        <div className="flex justify-between items-center px-4 md:px-8 h-16 md:h-20">
          {/* Left: Logo + Desktop Nav */}
          <div className="flex items-center gap-4 md:gap-8 min-w-0">
            <Link to="/" className="text-xl md:text-2xl font-black italic tracking-tight shrink-0 text-primary">
              금고지기
            </Link>
            <nav className="hidden md:flex items-center gap-5 text-sm font-medium tracking-tight">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={
                    isActive(item.path)
                      ? 'text-primary border-primary font-bold border-b-2 pb-1'
                      : 'text-on-surface-variant hover:text-primary transition-colors duration-200'
                  }
                >
                  <span className="hidden md:inline">{item.desktopLabel}</span>
                  <span className="md:hidden">{item.mobileLabel}</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: Credit + Actions */}
          <div className="flex items-center gap-2 md:gap-4 shrink-0">
            <button
              onClick={openCreditModal}
              className="hidden sm:inline-block px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm tabular-nums cursor-pointer transition-colors bg-surface-container text-primary hover:bg-surface-container-high"
            >
              1,250.3 C
            </button>

            <button
              onClick={handleConnectGmail}
              disabled={isConnectingGmail}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm cursor-pointer transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
              title={`Gmail 읽기 전용 연동 · ${formatLastSync(lastGmailSyncAt)}`}
            >
              <span className="material-symbols-outlined text-base">mark_email_read</span>
              {(gmailSyncStatus || phaseFallbackLabel[gmailSyncPhase] || 'Gmail 연동')}
            </button>

            <button
              onClick={handleResetGmailTestData}
              disabled={isClearingGmail}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm cursor-pointer transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
              title="Gmail 테스트 기록 초기화"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
              {isClearingGmail ? '초기화 중...' : 'Gmail 기록 초기화'}
            </button>

            <button className="p-2 rounded-full transition-all active:scale-95 text-on-surface-variant hover:bg-primary/10">
              <span className="material-symbols-outlined">notifications</span>
            </button>

            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden border-2 cursor-pointer transition-all bg-surface-container-high border-surface-container-lowest hover:ring-2 hover:ring-primary/20">
              <div className="w-full h-full flex items-center justify-center bg-primary/10">
                <span className="material-symbols-outlined text-xl text-primary">person</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        <nav className="md:hidden px-3 pb-2 grid grid-cols-4 gap-1 text-[11px] font-semibold tracking-tight">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`text-center py-2 rounded-lg transition-colors ${
                isActive(item.path)
                  ? 'text-primary bg-primary/10 font-bold'
                  : 'text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              <span className="hidden md:inline">{item.desktopLabel}</span>
              <span className="md:hidden">{item.mobileLabel}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
