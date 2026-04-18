import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
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

// 연동 버튼은 connectState 단일 상태머신으로만 라벨을 결정한다.
// gmailSyncPhase(전역)는 보조 시그널로만 사용하며, 라벨 문구에 직접 개입하지 않는다.
const CONNECT_LABELS = {
  idle: 'Gmail 연동',
  requesting_auth: '권한 요청 중...',
  verifying: '연결 확인 중...',
  syncing: '메일 가져오는 중...',
  success: '동기화 완료',
  error: '연동 오류',
}

const CONNECT_HARD_TIMEOUT_MS = 25_000
const OAUTH_STEP_TIMEOUT_MS = 10_000

export default function TopNavBar() {
  const location = useLocation()
  const {
    openCreditModal,
    gmailSyncPhase,
    lastGmailSyncAt,
    setGmailSyncState,
    setLastGmailSyncAt,
    clearGmailHistoryClearBadge,
  } = useUIStore()
  const [connectState, setConnectState] = useState('idle')
  const [resetState, setResetState] = useState('idle')
  const [toast, setToast] = useState(null) // { type: 'success' | 'error', message: string }
  const resetTimeoutRef = useRef(null)
  const connectTimeoutRef = useRef(null)
  const isActive = (path) => location.pathname === path
  const connectLabel = CONNECT_LABELS[connectState] || CONNECT_LABELS.idle

  const isConnectingGmail =
    connectState === 'requesting_auth' || connectState === 'verifying' || connectState === 'syncing'
  const isClearingGmail = resetState === 'resetting'

  // setTimeout은 백그라운드 탭에서 스로틀될 수 있어 setInterval + performance.now() 폴링 방식으로 전환.
  // 1초 간격으로 경과 시간을 체크하기 때문에 OAuth 팝업이 포커스를 가져가도 비교적 안정적으로 발화한다.
  const clearConnectTimer = () => {
    if (connectTimeoutRef.current) {
      window.clearInterval(connectTimeoutRef.current.intervalId)
      connectTimeoutRef.current = null
    }
  }

  const armConnectHardTimeout = () => {
    clearConnectTimer()
    const startedAt = performance.now()
    const intervalId = window.setInterval(() => {
      const elapsed = performance.now() - startedAt
      if (elapsed < CONNECT_HARD_TIMEOUT_MS) return
      console.info('[GmailConnect] hard timeout fired', { elapsedMs: Math.round(elapsed) })
      clearConnectTimer()
      setConnectState('error')
      setGmailSyncState('error', 'Gmail 연동 지연됨')
      setToast({ type: 'error', message: 'Gmail 연동이 지연되어 취소되었습니다. 다시 시도해 주세요.' })
    }, 1000)
    connectTimeoutRef.current = { intervalId, startedAt }
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

  // gmailSyncPhase는 보조 시그널: 성공/에러/동기화 중 상태만 connectState로 반영.
  // 라벨 자체는 항상 connectState 기반으로 그려진다.
  useEffect(() => {
    if (connectState === 'requesting_auth' || connectState === 'verifying') {
      return undefined
    }
    if (gmailSyncPhase === 'reading' || gmailSyncPhase === 'parsing') {
      setConnectState((prev) => (prev === 'syncing' ? prev : 'syncing'))
      return undefined
    }
    if (gmailSyncPhase === 'success') {
      clearConnectTimer()
      setConnectState('success')
      const timer = window.setTimeout(() => setConnectState('idle'), 5000)
      return () => window.clearTimeout(timer)
    }
    if (gmailSyncPhase === 'error') {
      clearConnectTimer()
      setConnectState('error')
      const timer = window.setTimeout(() => setConnectState('idle'), 6000)
      return () => window.clearTimeout(timer)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectState, gmailSyncPhase])

  // HMR/재마운트 이후에도 requesting_auth, verifying 상태면 하드 타임아웃 가드를 다시 장착한다.
  useEffect(() => {
    if (connectState === 'requesting_auth' || connectState === 'verifying') {
      if (!connectTimeoutRef.current) {
        armConnectHardTimeout()
      }
      return undefined
    }
    if (connectState === 'idle' || connectState === 'success' || connectState === 'error') {
      clearConnectTimer()
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectState])

  // syncing 상태가 서비스워커 이벤트 없이 너무 오래 지속되는 경우 안전 복귀.
  useEffect(() => {
    if (connectState !== 'syncing') return
    const timer = window.setTimeout(() => {
      console.info('[GmailConnect] syncing watchdog → idle')
      setConnectState('idle')
      setGmailSyncState('idle', '')
    }, 35_000)
    return () => window.clearTimeout(timer)
  }, [connectState, setGmailSyncState])

  // 상태 전이 가시화: connectState / gmailSyncPhase 가 어떤 순서로 바뀌는지 콘솔에 실시간 출력.
  useEffect(() => {
    console.info('[GmailConnect] state', { connectState, gmailSyncPhase })
  }, [connectState, gmailSyncPhase])

  useEffect(() => {
    console.info('[GmailConnect] render label', { connectState, connectLabel, gmailSyncPhase })
  }, [connectLabel, connectState, gmailSyncPhase])

  useEffect(() => {
    if (resetState !== 'error') return
    const timer = window.setTimeout(() => setResetState('idle'), 4000)
    return () => window.clearTimeout(timer)
  }, [resetState])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      clearConnectTimer()
      if (resetTimeoutRef.current) {
        window.clearTimeout(resetTimeoutRef.current)
        resetTimeoutRef.current = null
      }
    }
  }, [])

  const handleConnectGmail = async () => {
    if (isConnectingGmail) return
    console.info('[GmailConnect] enter handleConnectGmail')
    setToast(null)
    setConnectState('requesting_auth')
    setGmailSyncState('connecting', '')
    armConnectHardTimeout()
    try {
      const token = await withTimeout(
        connectGmailReadonly(),
        OAUTH_STEP_TIMEOUT_MS,
        '권한 요청이 지연되고 있습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'
      )
      console.info('[GmailConnect] oauth callback ok')
      setConnectState('verifying')

      // ───────── verifying 단계를 스텝별로 분해 + 자체 타임아웃 + 로그 ─────────
      console.info('[GmailConnect] step: validate start')
      await withTimeout(
        validateGmailReadonlyAccess(token.accessToken),
        8_000,
        'Gmail 프로필 확인이 지연되고 있습니다.'
      )
      console.info('[GmailConnect] step: validate ok')

      console.info('[GmailConnect] step: digestPref start')
      await withTimeout(setDigestHourPreference(20), 3_000, 'IndexedDB 쓰기가 지연되고 있습니다.')
      console.info('[GmailConnect] step: digestPref ok')

      if (Notification.permission === 'default') {
        console.info('[GmailConnect] step: notif start')
        await Promise.race([
          Notification.requestPermission(),
          new Promise((resolve) => window.setTimeout(() => resolve('default'), 5_000)),
        ])
        console.info('[GmailConnect] step: notif ok', { permission: Notification.permission })
      } else {
        console.info('[GmailConnect] step: notif skip', { permission: Notification.permission })
      }

      console.info('[GmailConnect] step: swReady start')
      let registration = null
      try {
        registration = await Promise.race([
          navigator.serviceWorker?.ready ?? Promise.resolve(null),
          new Promise((resolve) => window.setTimeout(() => resolve(null), 3_000)),
        ])
        console.info('[GmailConnect] step: swReady ok', { hasActive: Boolean(registration?.active) })
      } catch (swError) {
        console.info('[GmailConnect] step: swReady fail', swError)
        registration = null
      }

      if (registration?.active) {
        registration.active.postMessage({ type: 'SET_GMAIL_DIGEST_HOUR', payload: 20 })
        registration.active.postMessage({ type: 'GMAIL_SYNC_TICK' })
        console.info('[GmailConnect] step: sw messages posted')
      } else {
        console.info('[GmailConnect] step: sw messages skipped (no active worker)')
      }
      // ─────────────────────────────────────────────────────────────────────
      clearConnectTimer()
      setConnectState('syncing')
      setGmailSyncState('reading', '')
      setToast({ type: 'success', message: 'Gmail 연동 완료. 메일을 가져오는 중입니다.' })
    } catch (error) {
      console.info('[GmailConnect] failure', error)
      clearConnectTimer()
      setConnectState('error')
      setGmailSyncState('error', 'Gmail 연동 실패')
      const message = error instanceof Error ? error.message : 'Gmail 연동 중 오류가 발생했습니다.'
      setToast({ type: 'error', message })
    }
  }

  const handleResetGmailTestData = async () => {
    if (isClearingGmail) return
    clearGmailHistoryClearBadge()
    setToast(null)
    setResetState('resetting')
    let settled = false
    if (resetTimeoutRef.current) {
      window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = null
    }
    resetTimeoutRef.current = window.setTimeout(() => {
      if (settled) return
      settled = true
      setResetState('error')
      setToast({ type: 'error', message: '초기화가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' })
    }, 8000)
    try {
      await clearGmailSyncTestData(true)
      if (settled) return
      settled = true
      setLastGmailSyncAt(null)
      setResetState('idle')
      setToast({ type: 'success', message: 'Gmail 테스트 기록 초기화 완료' })
    } catch (error) {
      if (settled) return
      settled = true
      clearGmailHistoryClearBadge()
      setResetState('error')
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Gmail 기록 초기화 중 오류가 발생했습니다.',
      })
    } finally {
      if (resetTimeoutRef.current) {
        window.clearTimeout(resetTimeoutRef.current)
        resetTimeoutRef.current = null
      }
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
              key={`gmail-connect-${connectState}`}
              onClick={handleConnectGmail}
              disabled={isConnectingGmail}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm cursor-pointer transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
              title={`Gmail 읽기 전용 연동 · ${formatLastSync(lastGmailSyncAt)}`}
              data-connect-state={connectState}
              data-connect-label={connectLabel}
            >
              <span className="material-symbols-outlined text-base">mark_email_read</span>
              {connectLabel}
            </button>

            <button
              onClick={handleResetGmailTestData}
              disabled={isClearingGmail}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm cursor-pointer transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
              title="Gmail 테스트 기록 초기화"
            >
              <span className="material-symbols-outlined text-base">restart_alt</span>
              Gmail 기록 초기화
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
      {toast ? (
        <div className="fixed top-24 right-6 z-[60]">
          <div
            className={`px-4 py-3 rounded-2xl shadow-lg text-sm font-semibold ${
              toast.type === 'error' ? 'bg-[#7a1a1a] text-white' : 'bg-[#1e5f2d] text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </header>
  )
}
