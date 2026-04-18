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
    lastGmailSyncAt,
    gmailHistoryClearedUntil,
    setGmailSyncState,
    setLastGmailSyncAt,
    markGmailHistoryClearComplete,
    clearGmailHistoryClearBadge,
  } = useUIStore()
  const [connectState, setConnectState] = useState('idle')
  const [resetState, setResetState] = useState('idle')
  const isActive = (path) => location.pathname === path

  const isConnectingGmail =
    connectState === 'requesting_auth' || connectState === 'verifying' || connectState === 'syncing'
  const isClearingGmail = resetState === 'resetting'

  const getConnectLabel = (state, phase) => {
    const labels = {
      idle: 'Gmail 연동',
      requesting_auth: '권한 요청 중...',
      verifying: '연결 확인 중...',
      syncing: phase === 'parsing' ? '메일 분석 중...' : '메일 가져오는 중...',
      success: '동기화 완료',
      error: '연동 오류',
    }
    return labels[state] || labels.idle
  }

  const getResetLabel = (state) => {
    const labels = {
      idle: 'Gmail 기록 초기화',
      resetting: '초기화 중...',
      reset_done: '초기화 완료',
      error: '초기화 실패',
    }
    return labels[state] || labels.idle
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
    if (!gmailHistoryClearedUntil || Date.now() >= gmailHistoryClearedUntil) return
    setResetState('reset_done')
    const delay = gmailHistoryClearedUntil - Date.now()
    const id = window.setTimeout(() => {
      clearGmailHistoryClearBadge()
      setResetState('idle')
    }, delay)
    return () => window.clearTimeout(id)
  }, [gmailHistoryClearedUntil, clearGmailHistoryClearBadge])

  useEffect(() => {
    if (connectState !== 'requesting_auth' && connectState !== 'verifying') return
    const id = window.setTimeout(() => {
      setConnectState('error')
      setGmailSyncState('error', 'Gmail 연동 지연됨')
    }, 20_000)
    return () => window.clearTimeout(id)
  }, [connectState, setGmailSyncState])

  useEffect(() => {
    if (connectState !== 'syncing') return
    const timer = window.setTimeout(() => {
      setConnectState('idle')
      setGmailSyncState('idle', '')
    }, 35000)
    return () => window.clearTimeout(timer)
  }, [connectState, setGmailSyncState])

  useEffect(() => {
    if (gmailSyncPhase === 'reading' || gmailSyncPhase === 'parsing') {
      setConnectState('syncing')
      return
    }
    if (gmailSyncPhase === 'success') {
      setConnectState('success')
      const timer = window.setTimeout(() => setConnectState('idle'), 5000)
      return () => window.clearTimeout(timer)
    }
    if (gmailSyncPhase === 'error') {
      setConnectState('error')
      const timer = window.setTimeout(() => setConnectState('idle'), 6000)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [gmailSyncPhase])

  useEffect(() => {
    if (resetState !== 'error') return
    const timer = window.setTimeout(() => setResetState('idle'), 5000)
    return () => window.clearTimeout(timer)
  }, [resetState])

  const handleConnectGmail = async () => {
    if (isConnectingGmail) return
    setConnectState('requesting_auth')
    setGmailSyncState('connecting', '')
    try {
      const token = await withTimeout(
        connectGmailReadonly(),
        10000,
        '권한 요청이 지연되고 있습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'
      )
      setConnectState('verifying')
      const registration = await withTimeout(
        (async () => {
          await validateGmailReadonlyAccess(token.accessToken)
          await setDigestHourPreference(20)
          if (Notification.permission === 'default') {
            await Promise.race([
              Notification.requestPermission(),
              new Promise((resolve) => window.setTimeout(() => resolve('default'), 8000)),
            ])
          }
          return navigator.serviceWorker?.ready ?? Promise.resolve(null)
        })(),
        10000,
        'Gmail 연결 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
      )
      registration?.active?.postMessage({ type: 'SET_GMAIL_DIGEST_HOUR', payload: 20 })
      registration?.active?.postMessage({ type: 'GMAIL_SYNC_TICK' })
      setConnectState('syncing')
      setGmailSyncState('reading', '')
      window.alert('Gmail 읽기 전용 연동이 완료되었습니다. 이제 결제 메일을 조용히 정리합니다.')
    } catch (error) {
      setConnectState('error')
      setGmailSyncState('error', 'Gmail 연동 실패')
      window.alert(error instanceof Error ? error.message : 'Gmail 연동 중 오류가 발생했습니다.')
    }
  }

  const handleResetGmailTestData = async () => {
    if (isClearingGmail) return
    const ok = window.confirm(
      'Gmail 테스트 기록(읽은 메일 ID/일일 카운트/대기 큐)을 초기화할까요?\nOAuth 연동 정보는 유지됩니다.'
    )
    if (!ok) return

    clearGmailHistoryClearBadge()
    setResetState('resetting')
    try {
      await withTimeout(
        clearGmailSyncTestData(true),
        10000,
        'Gmail 기록 초기화가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
      )
      setLastGmailSyncAt(null)
      markGmailHistoryClearComplete(12000)
      setResetState('reset_done')
      window.alert('Gmail 테스트 기록 초기화가 완료되었습니다. 마지막 동기화 시각도 초기화되었습니다.')
    } catch (error) {
      clearGmailHistoryClearBadge()
      setResetState('error')
      window.alert(error instanceof Error ? error.message : 'Gmail 기록 초기화 중 오류가 발생했습니다.')
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
              {getConnectLabel(connectState, gmailSyncPhase)}
            </button>

            <button
              onClick={handleResetGmailTestData}
              disabled={isClearingGmail}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm cursor-pointer transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
              title="Gmail 테스트 기록 초기화"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
              {getResetLabel(resetState)}
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
