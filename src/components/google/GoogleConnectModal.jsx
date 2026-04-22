import { useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { connectGoogleWorkspace } from '../../lib/googleIntegration'
import { setDigestHourPreference, validateGmailReadonlyAccess } from '../../lib/gmailSync'
import { buildFullBackupSnapshot } from '../../lib/backupSnapshot'
import { uploadBackupSnapshot, validateDriveAppDataAccess } from '../../lib/googleDriveSync'

export default function GoogleConnectModal({ isOpen, onClose, onConnected }) {
  const { setDriveBackupState, setLastDriveBackupAt, setGmailSyncState } = useUIStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  const handleConnect = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError('')
    setGmailSyncState('connecting', 'Google 통합 연동 중...')
    setDriveBackupState('connecting', 'Google Drive 백업금고 연결 중...', false)

    try {
      const { gmailToken, driveToken } = await connectGoogleWorkspace()
      await Promise.all([
        validateGmailReadonlyAccess(gmailToken.accessToken),
        validateDriveAppDataAccess(driveToken.accessToken),
        setDigestHourPreference(20),
      ])

      const snapshot = buildFullBackupSnapshot()
      const uploaded = await uploadBackupSnapshot(snapshot)
      setLastDriveBackupAt(new Date(uploaded.modifiedTime).getTime())
      setDriveBackupState('success', '개인 백업금고 연결 및 초기 백업 완료', true)
      setGmailSyncState('success', 'Google 통합 연동 완료')
      onConnected?.()
      onClose?.()
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'Google 통합 연동 중 오류가 발생했습니다.'
      setError(message)
      setDriveBackupState('error', message, false)
      setGmailSyncState('error', message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={isSubmitting ? undefined : onClose} />

      <div className="relative z-10 w-full max-w-xl rounded-[28px] bg-surface-container-lowest shadow-2xl overflow-hidden">
        <div className="p-7 md:p-8">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="absolute top-5 right-5 text-outline hover:text-on-surface transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined">close</span>
          </button>

          <div className="pr-10">
            <h2 className="text-2xl font-black tracking-tight text-on-surface">Vaulter(금고지기) 100% 활용하기</h2>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              한 번만 연결하면 Gmail 영수증 자동 수집과 Google Drive 숨김 공간 자동 백업을 함께 사용할 수 있습니다.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            <div className="rounded-2xl bg-surface-container-low p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">📩</span>
                <div>
                  <div className="font-bold text-on-surface">이메일 영수증 자동 수집</div>
                  <div className="mt-1 text-sm text-on-surface-variant">
                    Gmail 읽기 권한으로 결제/영수증 메일을 자동 수집해 원장 후보로 정리합니다.
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-surface-container-low p-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">🛡️</span>
                <div>
                  <div className="font-bold text-on-surface">내 구글 드라이브에 안전한 자동 백업</div>
                  <div className="mt-1 text-sm text-on-surface-variant">
                    로컬 원장은 내 기기에 두고, Google Drive 숨김 폴더에 `vaulter_backup.json` 스냅샷을 덮어써 자동 백업합니다.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-primary/5 px-4 py-3 text-xs leading-relaxed text-on-surface-variant">
            일반 Google Drive 파일함에는 보이지 않는 앱 전용 숨김 공간을 사용합니다. 연결 후에는 설정에서 상태를 확인하거나 연결을 해제할 수 있습니다.
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            onClick={handleConnect}
            disabled={isSubmitting}
            className="mt-6 w-full rounded-2xl bg-gradient-to-r from-primary to-primary-dim px-6 py-4 text-base font-bold text-white shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            {isSubmitting ? 'Google 계정 연결 중...' : '구글 계정으로 한 번에 연결하기'}
          </button>
        </div>
      </div>
    </div>
  )
}
