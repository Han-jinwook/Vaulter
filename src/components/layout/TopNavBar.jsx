import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'
import GoogleConnectModal from '../google/GoogleConnectModal'
import { getGoogleIntegrationStatus } from '../../lib/googleIntegration'
import {
  clearGmailSyncTestData,
  clearStoredGmailAuth,
  ensureGmailAccessToken,
  setDigestHourPreference,
  validateGmailReadonlyAccess,
} from '../../lib/gmailSync'
import { disconnectDriveBackupVault, uploadRotatedBackup } from '../../lib/googleDriveSync'
import { clearLocalVaultSnapshot } from '../../lib/localVaultPersistence'

const EMPTY_SNAPSHOT = {
  version: 1,
  exportedAt: '',
  transactions: [],
  messages: [],
  knownAccounts: [],
  lastLedgerDecision: null,
  ledgerContextTitle: '데이터 원장 (전체)',
  activeLedgerFilter: 'all',
  reviewPinnedTxIds: [],
}

// DEV-only: 각 TopNavBar 인스턴스에 고유 ID를 부여해서 중복 마운트를 즉시 탐지한다
let _instanceCounter = 0

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
    openSettingsModal,
    gmailSyncPhase,
    gmailConnectState,
    lastGmailSyncAt,
    setGmailConnectState,
    setGmailSyncState,
    setLastGmailSyncAt,
    clearGmailHistoryClearBadge,
    setDriveBackupState,
  } = useUIStore()
  const exportBackupSnapshot = useVaultStore((s) => s.exportBackupSnapshot)
  const restoreFromBackupSnapshot = useVaultStore((s) => s.restoreFromBackupSnapshot)
  const [resetState, setResetState] = useState('idle')
  const [toast, setToast] = useState(null) // { type: 'success' | 'error', message: string }
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false)
  const resetTimeoutRef = useRef(null)
  const connectTimeoutRef = useRef(null)
  // DEV: 인스턴스 고유 ID (마운트 시 할당 → 중복 마운트 탐지용)
  const instanceIdRef = useRef(null)
  const renderCountRef = useRef(0)
  if (instanceIdRef.current === null) {
    instanceIdRef.current = ++_instanceCounter
  }
  renderCountRef.current += 1
  const isActive = (path) => location.pathname === path
  const connectState = gmailConnectState || 'idle'
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
      setGmailConnectState('error')
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
      if (connectState !== 'syncing') {
        setGmailConnectState('syncing')
      }
      return undefined
    }
    if (gmailSyncPhase === 'success') {
      clearConnectTimer()
      setGmailConnectState('success')
      const timer = window.setTimeout(() => setGmailConnectState('idle'), 5000)
      return () => window.clearTimeout(timer)
    }
    if (gmailSyncPhase === 'error') {
      clearConnectTimer()
      setGmailConnectState('error')
      const timer = window.setTimeout(() => setGmailConnectState('idle'), 6000)
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
      setGmailConnectState('idle')
      setGmailSyncState('idle', '')
    }, 35_000)
    return () => window.clearTimeout(timer)
  }, [connectState, setGmailConnectState, setGmailSyncState])

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

  const executeGmailConnect = async () => {
    if (isConnectingGmail) return
    console.info('[GmailConnect] enter handleConnectGmail')
    setToast(null)
    setGmailConnectState('requesting_auth')
    setGmailSyncState('connecting', '')
    armConnectHardTimeout()
    try {
      const accessToken = await withTimeout(
        ensureGmailAccessToken(),
        OAUTH_STEP_TIMEOUT_MS,
        'Google 통합 연결 확인이 지연되고 있습니다. 다시 시도해 주세요.'
      )
      console.info('[GmailConnect] stored token ready')
      setGmailConnectState('verifying')

      // ───────── verifying 단계를 스텝별로 분해 + 자체 타임아웃 + 로그 ─────────
      console.info('[GmailConnect] step: validate start')
      await withTimeout(
        validateGmailReadonlyAccess(accessToken),
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
      setGmailConnectState('syncing')
      setGmailSyncState('reading', '')
      setToast({ type: 'success', message: 'Gmail 연동 완료. 메일을 가져오는 중입니다.' })
    } catch (error) {
      console.info('[GmailConnect] failure', error)
      clearConnectTimer()
      const message = error instanceof Error ? error.message : 'Gmail 연동 중 오류가 발생했습니다.'
      // 토큰 만료 / 미연동: 저장 토큰 정리 후 통합 재인증 모달로 유도
      if (error instanceof Error && (message.includes('만료') || message.includes('연동되지 않았습니다'))) {
        clearStoredGmailAuth().catch(() => {})
        setGmailConnectState('idle')
        setGmailSyncState('idle', '')
        setIsGoogleModalOpen(true)
        return
      }
      setGmailConnectState('error')
      setGmailSyncState('error', 'Gmail 연동 실패')
      setToast({ type: 'error', message })
    }
  }

  const handleConnectGmail = async () => {
    try {
      const integration = await getGoogleIntegrationStatus()
      if (!integration.combinedConnected) {
        setIsGoogleModalOpen(true)
        return
      }
      await executeGmailConnect()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google 통합 상태 확인 중 오류가 발생했습니다.'
      setToast({ type: 'error', message })
    }
  }

  const handleResetAllData = async () => {
    if (isClearingGmail) return
    if (!window.confirm('모든 거래 내역, 메시지, 계좌 정보가 삭제됩니다.\n계속하시겠습니까?')) return
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
      // 1) Drive가 연결돼 있으면 초기화 전 현재 상태를 'pre-reset' 태그 백업으로 먼저 저장
      //    → 설정 > 백업 히스토리에서 복원 가능
      const { driveBackupConnected } = useUIStore.getState()
      if (driveBackupConnected) {
        try {
          await uploadRotatedBackup(exportBackupSnapshot(), 'pre-reset')
        } catch (e) {
          console.warn('[Reset] pre-reset backup failed (계속 진행)', e)
        }
      }
      // 2) Drive 연결 해제 — 이후 원장 변경이 Drive로 자동 업로드되지 않도록
      await disconnectDriveBackupVault()
      setDriveBackupState('idle', '', false)
      // 3) 인메모리 원장 초기화 (Drive 이미 해제됐으므로 자동백업 안 됨)
      restoreFromBackupSnapshot(EMPTY_SNAPSHOT)
      // 4) IndexedDB 정리: 로컬 스냅샷, Gmail 기록, Gmail 토큰
      await Promise.all([
        clearLocalVaultSnapshot(),
        clearGmailSyncTestData(false),
        clearStoredGmailAuth(),
      ])
      if (settled) return
      settled = true
      setLastGmailSyncAt(null)
      setGmailConnectState('idle')
      setGmailSyncState('idle', '')
      setResetState('idle')
      setToast({ type: 'success', message: '전체 데이터 초기화 완료 (Gmail·Drive 연동 해제됨)' })
    } catch (error) {
      if (settled) return
      settled = true
      setResetState('error')
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : '데이터 초기화 중 오류가 발생했습니다.',
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
      {import.meta.env.DEV && (
        <div
          style={{
            position: 'fixed',
            bottom: 12,
            left: 12,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.82)',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '7px 10px',
            borderRadius: 8,
            lineHeight: 1.6,
            pointerEvents: 'none',
            userSelect: 'none',
            whiteSpace: 'pre',
          }}
        >
          {`[NavBar #${instanceIdRef.current}  r:${renderCountRef.current}]\nstore gmailConnectState : ${gmailConnectState ?? 'undefined'}\nstore gmailSyncPhase   : ${gmailSyncPhase}\nlocal connectState     : ${connectState}\nbutton connectLabel    : ${connectLabel}`}
        </div>
      )}
      <GoogleConnectModal
        isOpen={isGoogleModalOpen}
        onClose={() => setIsGoogleModalOpen(false)}
        onConnected={() => {
          setIsGoogleModalOpen(false)
          executeGmailConnect()
        }}
      />
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
              {import.meta.env.DEV && (
                <span style={{ fontSize: '9px', opacity: 0.6, marginLeft: 2 }}>
                  #{instanceIdRef.current}
                </span>
              )}
            </button>

            <button
              onClick={openSettingsModal}
              className="p-2 rounded-full transition-all active:scale-95 text-on-surface-variant hover:bg-primary/10"
              title="설정"
            >
              <span className="material-symbols-outlined">settings</span>
            </button>

            <button
              onClick={handleResetAllData}
              disabled={isClearingGmail}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-full font-bold text-xs md:text-sm cursor-pointer transition-colors bg-surface-container text-on-surface-variant hover:bg-surface-container-high disabled:opacity-50"
              title="전체 데이터 초기화 (원장·Gmail 기록)"
            >
              <span className="material-symbols-outlined text-base">delete_sweep</span>
              전체 초기화
            </button>

            <button className="p-2 rounded-full transition-all active:scale-95 text-on-surface-variant hover:bg-primary/10">
              <span className="material-symbols-outlined">notifications</span>
            </button>

            <div
              onClick={openSettingsModal}
              className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden border-2 cursor-pointer transition-all bg-surface-container-high border-surface-container-lowest hover:ring-2 hover:ring-primary/20"
              title="설정 열기"
            >
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
