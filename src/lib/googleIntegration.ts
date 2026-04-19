import {
  GMAIL_SCOPE,
  ensureGoogleIdentityScript,
  getStoredGmailAuth,
  storeGmailAuth,
  type GmailAuthToken,
} from './gmailSync'
import {
  DRIVE_SCOPE,
  getDriveBackupStatus,
  storeDriveAuth,
  type GoogleDriveAuthToken,
} from './googleDriveSync'

export type GoogleIntegrationStatus = {
  gmailConnected: boolean
  driveConnected: boolean
  combinedConnected: boolean
}

export async function getGoogleIntegrationStatus(): Promise<GoogleIntegrationStatus> {
  const gmail = await getStoredGmailAuth()
  const drive = await getDriveBackupStatus()
  // 토큰이 있어도 만료됐으면 미연결로 취급 (ensureGmailAccessToken과 동일 기준: +60s)
  const gmailConnected = Boolean(gmail?.accessToken) && (gmail?.expiresAt ?? 0) > Date.now() + 60_000
  return {
    gmailConnected,
    driveConnected: drive.connected,
    combinedConnected: gmailConnected && drive.connected,
  }
}

export async function connectGoogleWorkspace(): Promise<{
  gmailToken: GmailAuthToken
  driveToken: GoogleDriveAuthToken
}> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.')
  }

  await ensureGoogleIdentityScript()
  const existing = await getStoredGmailAuth()
  const combinedScope = [GMAIL_SCOPE, DRIVE_SCOPE].join(' ')

  return new Promise((resolve, reject) => {
    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const resolveOnce = (value: { gmailToken: GmailAuthToken; driveToken: GoogleDriveAuthToken }) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: combinedScope,
      prompt: existing ? '' : 'consent',
      callback: async (response) => {
        if (settled) return
        if ((response as any).error || !response.access_token) {
          rejectOnce(new Error(`Google OAuth 실패: ${(response as any).error || 'unknown'}`))
          return
        }

        try {
          const base = {
            accessToken: response.access_token,
            expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            scope: response.scope || combinedScope,
            tokenType: response.token_type || 'Bearer',
          }
          const gmailToken: GmailAuthToken = {
            ...base,
            refreshToken: (response as any).refresh_token || existing?.refreshToken || null,
          }
          const driveToken: GoogleDriveAuthToken = {
            ...base,
          }
          await Promise.all([storeGmailAuth(gmailToken), storeDriveAuth(driveToken)])
          resolveOnce({ gmailToken, driveToken })
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error('Google 통합 토큰 저장 중 오류가 발생했습니다.'))
        }
      },
      error_callback: (error) => {
        const type = error?.type || 'unknown'
        if (type === 'popup_closed') {
          rejectOnce(new Error('Google 로그인 팝업이 닫혀 통합 연동이 취소되었습니다.'))
          return
        }
        if (type === 'popup_failed_to_open') {
          rejectOnce(new Error('Google 로그인 팝업을 열지 못했습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'))
          return
        }
        rejectOnce(new Error(`Google OAuth 요청 실패: ${type}`))
      },
    })

    tokenClient.requestAccessToken()
  })
}
