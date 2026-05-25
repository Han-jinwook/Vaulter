import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { HubProfileCard, HubNotificationCard, HubLogoutCard, HubReferralWidget } from '../services/merlin-hub-sdk/react'

// Stores and Libs for Data Reset (Danger Zone)
import { useUIStore } from '../stores/uiStore'
import { useVaultStore } from '../stores/vaultStore'
import { useAssetStore } from '../stores/assetStore'
import { clearGmailSyncTestData, clearStoredGmailAuth } from '../lib/gmailSync'
import { buildFullBackupSnapshot, buildLocalKvSnapshot } from '../lib/backupSnapshot'
import { disconnectDriveBackupVault, uploadRotatedBackup } from '../lib/googleDriveSync'
import { clearLocalVaultSnapshot, writeLocalVaultSnapshot } from '../lib/localVaultPersistence'

const EMPTY_SNAPSHOT = {
  version: 1,
  exportedAt: '',
  transactions: [],
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
}

export default function SettingsPage() {
  const navigate = useNavigate()
  
  // Notification State
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem('hubSmartNotification') || localStorage.getItem('hubMarketingConsent')
    return stored === null ? true : stored === 'true'
  })

  const handleToggle = (nextVal) => {
    setEnabled(nextVal)
    localStorage.setItem('hubSmartNotification', nextVal ? 'true' : 'false')
    localStorage.setItem('hubMarketingConsent', nextVal ? 'true' : 'false')
  }

  // Reset State (Danger Zone) & UI Store Actions
  const {
    driveBackupConnected,
    connectedEmail,
    openSettingsModal,
    setDriveBackupState,
    setGmailConnectState,
    setGmailSyncState,
    setLastGmailSyncAt,
    setConnectedEmail,
  } = useUIStore()

  const clearGmailHistoryClearBadge = useUIStore((s) => s.clearGmailHistoryClearBadge)
  const restoreFromBackupSnapshot = useVaultStore((s) => s.restoreFromBackupSnapshot)

  const [resetState, setResetState] = useState('idle')
  const [toast, setToast] = useState(null) // { type: 'success' | 'error', message: string }
  const resetTimeoutRef = useRef(null)

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
      if (resetTimeoutRef.current) {
        window.clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  const handleResetAllData = async () => {
    if (resetState === 'resetting') return
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
      // 1) Drive 백업 자동 수행
      const { driveBackupConnected } = useUIStore.getState()
      if (driveBackupConnected) {
        try {
          await uploadRotatedBackup(buildFullBackupSnapshot(), 'pre-reset')
        } catch (e) {
          console.warn('[Reset] pre-reset backup failed (계속 진행)', e)
        }
      }

      // 2) Drive 연결 해제
      await disconnectDriveBackupVault()
      setDriveBackupState('idle', '', false)
      setConnectedEmail(null)
      localStorage.removeItem('vaulter_google_connected_email')

      // 3) 인메모리 원장·황금자산 초기화
      restoreFromBackupSnapshot(EMPTY_SNAPSHOT)
      await useAssetStore.getState().hydrateFromSnapshot([])

      // 4) IndexedDB 정리
      await Promise.all([
        clearLocalVaultSnapshot(),
        clearGmailSyncTestData(false),
        clearStoredGmailAuth(),
      ])
      await writeLocalVaultSnapshot(buildLocalKvSnapshot())

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
    <div className="-mx-4 md:-mx-8 px-4 md:px-8 py-6 min-h-full space-y-6 bg-surface text-on-surface animate-fade-in">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Left Column */}
          <div className="space-y-6">
            {/* 로컬 앱 설정 카드 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 sm:p-8">
                <h2 className="text-xl font-bold text-slate-800 mb-2">구글 연동 & 로컬 앱 연동</h2>
                <p className="text-sm text-slate-500 mb-6">
                  Google 계정 통합 연동(이메일 영수증 자동 수집 & 드라이브 백업) 및 단축어 Webhook 등 로컬 앱 환경 설정을 구성합니다.
                </p>

                <div className="space-y-4 mb-6">
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-slate-500 font-medium">google</span>
                      <div>
                        <span className="block text-sm font-semibold text-slate-700">Google 통합 연동</span>
                        <span className="block text-xs text-slate-400 mt-0.5">이메일 영수증 자동 수집 & 구글 드라이브 백업</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {driveBackupConnected && connectedEmail && (
                        <span className="text-xs font-medium text-slate-500">{connectedEmail}</span>
                      )}
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${driveBackupConnected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        {driveBackupConnected ? '연결됨' : '미연결'}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={openSettingsModal}
                  className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors shadow-sm cursor-pointer animate-interactive"
                >
                  <span className="material-symbols-outlined text-base">settings</span>
                  설정 열기
                </button>
              </div>
            </div>

            {/* 친구 초대 보너스 위젯 */}
            <HubReferralWidget />
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* 1. 프로필 관리 카드 */}
            <HubProfileCard onSuccess={(nickname) => console.log('Profile updated', nickname)} />

            {/* 2. 알림 설정 카드 */}
            <HubNotificationCard
              title="알림 설정"
              toggleLabel="🔔 스마트 알림"
              description="볼트 서비스의 중요 혜택 및 허브 공통 기능/보너스 알림을 수신합니다."
              enabled={enabled}
              onChange={handleToggle}
            />

            {/* 3. 계정 로그아웃 카드 */}
            <HubLogoutCard onLogout={() => navigate('/')} />

            {/* 4. 위험 구역 (Danger Zone) 카드 */}
            <div className="bg-white rounded-2xl shadow-sm border border-red-100 overflow-hidden">
              <div className="p-6 sm:p-8">
                <h2 className="text-xl font-bold text-red-600 mb-2">위험 구역</h2>
                <p className="text-sm text-slate-500 mb-6">
                  볼트 서비스의 모든 데이터(거래 내역, 메시지, 계좌 정보 등)를 영구적으로 삭제하고, Gmail 연동 및 백업 연동을 해제합니다.
                </p>

                <button
                  onClick={handleResetAllData}
                  disabled={resetState === 'resetting'}
                  className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-red-50 border border-red-200 text-red-600 font-bold rounded-xl hover:bg-red-100 hover:border-red-300 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">delete_sweep</span>
                  {resetState === 'resetting' ? '초기화 진행 중...' : '전체 데이터 초기화'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed top-20 right-5 z-[60]">
          <div
            className={`px-4 py-3 rounded-2xl shadow-lg text-sm font-semibold ${
              toast.type === 'error' ? 'bg-[#7a1a1a] text-white' : 'bg-[#1e5f2d] text-white'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  )
}
