export type GoogleDriveAuthToken = {
  accessToken: string
  expiresAt: number
  scope: string
  tokenType: string
}

export type DriveBackupStatus = {
  connected: boolean
  hasSnapshot: boolean
  lastBackupAt: number | null
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_SYNC_DB = 'vaulter-google-drive-sync'
const DRIVE_SYNC_STORE = 'kv'
const KEY_DRIVE_AUTH = 'drive_auth'
const KEY_DRIVE_READONLY_AUTH = 'drive_readonly_auth'
const KEY_BACKUP_FILE_ID = 'backup_file_id'
const KEY_LAST_BACKUP_AT = 'last_backup_at'

export type SpreadsheetFileInfo = {
  id: string
  name: string
  modifiedTime: string
}
/** @deprecated 단일 파일 방식 — uploadRotatedBackup 으로 교체됨 */
const BACKUP_FILE_NAME = 'vaulter_backup.json'

const BACKUP_LATEST_NAME = 'vaulter_backup_latest.json'
const BACKUP_DATED_PREFIX = 'vaulter_backup_'
export const MAX_DATED_BACKUPS = 7

export type BackupFileInfo = {
  id: string
  name: string
  modifiedTime: string
  size: number
  label: string
}

type RawFileInfo = { id: string; name: string; modifiedTime: string; size?: number }

type DbValue = GoogleDriveAuthToken | string | number | null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRIVE_SYNC_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DRIVE_SYNC_STORE)) {
        db.createObjectStore(DRIVE_SYNC_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

async function dbGet<T extends DbValue>(key: string): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRIVE_SYNC_STORE, 'readonly')
    const store = tx.objectStore(DRIVE_SYNC_STORE)
    const req = store.get(key)
    req.onsuccess = () => resolve((req.result ?? null) as T)
    req.onerror = () => reject(req.error || new Error(`IndexedDB get failed: ${key}`))
  })
}

async function dbSet(key: string, value: DbValue): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRIVE_SYNC_STORE, 'readwrite')
    tx.objectStore(DRIVE_SYNC_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(`IndexedDB set failed: ${key}`))
  })
}

function ensureGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const already = document.querySelector('script[data-gsi-client="true"]')
    if (already) {
      already.addEventListener('load', () => resolve(), { once: true })
      already.addEventListener('error', () => reject(new Error('Google Identity SDK load failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.gsiClient = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google Identity SDK load failed'))
    document.head.appendChild(script)
  })
}

async function getStoredDriveAuth() {
  return dbGet<GoogleDriveAuthToken | null>(KEY_DRIVE_AUTH)
}

export async function storeDriveAuth(token: GoogleDriveAuthToken): Promise<void> {
  await dbSet(KEY_DRIVE_AUTH, token)
}

export async function clearStoredDriveAuth(): Promise<void> {
  await dbSet(KEY_DRIVE_AUTH, null)
}

async function requestDriveAccessToken(interactive = false) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.')
  }

  await ensureGoogleIdentityScript()
  const existing = await getStoredDriveAuth()

  return new Promise<GoogleDriveAuthToken>((resolve, reject) => {
    let settled = false
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const resolveOnce = (token: GoogleDriveAuthToken) => {
      if (settled) return
      settled = true
      resolve(token)
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      prompt: interactive || !existing ? 'consent' : '',
      callback: async (response) => {
        if (settled) return
        if ((response as any).error || !response.access_token) {
          rejectOnce(new Error(`Google Drive OAuth 실패: ${(response as any).error || 'unknown'}`))
          return
        }
        try {
          const token: GoogleDriveAuthToken = {
            accessToken: response.access_token,
            expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            scope: response.scope || DRIVE_SCOPE,
            tokenType: response.token_type || 'Bearer',
          }
          await dbSet(KEY_DRIVE_AUTH, token)
          resolveOnce(token)
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error('Google Drive 토큰 저장 중 오류가 발생했습니다.'))
        }
      },
      error_callback: (error) => {
        const type = error?.type || 'unknown'
        if (type === 'popup_closed') {
          rejectOnce(new Error('Google 로그인 팝업이 닫혀 백업금고 연결이 취소되었습니다.'))
          return
        }
        if (type === 'popup_failed_to_open') {
          rejectOnce(new Error('Google 로그인 팝업을 열지 못했습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'))
          return
        }
        rejectOnce(new Error(`Google Drive OAuth 요청 실패: ${type}`))
      },
    })

    tokenClient.requestAccessToken()
  })
}

async function ensureDriveAccessToken(interactive = false) {
  const token = await getStoredDriveAuth()
  if (token && token.expiresAt > Date.now() + 60_000) {
    return token.accessToken
  }
  if (!token && !interactive) {
    throw new Error('개인 백업금고가 아직 연결되지 않았습니다. 먼저 설정에서 연결해 주세요.')
  }
  const refreshed = await requestDriveAccessToken(interactive)
  return refreshed.accessToken
}

async function fetchDriveJson(path: string, accessToken?: string, init?: RequestInit) {
  const token = accessToken || (await ensureDriveAccessToken())
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...(init || {}),
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const text = await response.text()
    let detail = text
    try {
      const parsed = JSON.parse(text)
      detail = parsed?.error?.message || parsed?.error?.status || detail
    } catch {
      // keep raw text
    }
    throw new Error(`Google Drive 요청 실패 (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  return response.json()
}

async function findBackupFile(accessToken?: string) {
  const fileId = await dbGet<string | null>(KEY_BACKUP_FILE_ID)
  if (fileId) {
    try {
      const file = await fetchDriveJson(`files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime`, accessToken)
      return {
        id: String(file?.id || fileId),
        modifiedTime: String(file?.modifiedTime || ''),
      }
    } catch {
      await dbSet(KEY_BACKUP_FILE_ID, null)
    }
  }

  const query = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${BACKUP_FILE_NAME}' and trashed=false`,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '1',
  })

  const payload = await fetchDriveJson(`files?${query.toString()}`, accessToken)
  const file = Array.isArray(payload?.files) ? payload.files[0] : null
  if (!file?.id) return null
  await dbSet(KEY_BACKUP_FILE_ID, String(file.id))
  return {
    id: String(file.id),
    modifiedTime: String(file.modifiedTime || ''),
  }
}

function buildMultipartBody(metadata: Record<string, unknown>, jsonText: string) {
  const boundary = `vaulter_${Math.random().toString(36).slice(2)}`
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    jsonText,
    `--${boundary}--`,
  ].join('\r\n')
  return {
    boundary,
    body,
  }
}

export async function getDriveBackupStatus(): Promise<DriveBackupStatus> {
  const auth = await getStoredDriveAuth()
  const lastBackupAt = await dbGet<number | null>(KEY_LAST_BACKUP_AT)
  const snapshotMeta = auth ? await findBackupFile(auth.accessToken).catch(() => null) : null
  const hasSnapshot = Boolean(snapshotMeta?.id || (await dbGet<string | null>(KEY_BACKUP_FILE_ID)))
  return {
    connected: Boolean(auth),
    hasSnapshot,
    lastBackupAt: Number.isFinite(lastBackupAt as number) ? Number(lastBackupAt) : null,
  }
}

export async function connectDriveBackupVault(): Promise<DriveBackupStatus> {
  const token = await requestDriveAccessToken(true)
  await findBackupFile(token.accessToken)
  const status = await getDriveBackupStatus()
  return {
    ...status,
    connected: true,
  }
}

export async function validateDriveAppDataAccess(accessTokenOverride?: string): Promise<void> {
  const token = accessTokenOverride || (await ensureDriveAccessToken(false))
  await fetchDriveJson('files?spaces=appDataFolder&pageSize=1&fields=files(id)', token)
}

export async function disconnectDriveBackupVault(): Promise<void> {
  await clearStoredDriveAuth()
  await dbSet(KEY_DRIVE_READONLY_AUTH, null)
}

// ─── Google Drive Readonly (스프레드시트 마이그레이션) ──────────────────────

async function getStoredDriveReadonlyAuth() {
  return dbGet<GoogleDriveAuthToken | null>(KEY_DRIVE_READONLY_AUTH)
}

async function requestDriveReadonlyToken(): Promise<GoogleDriveAuthToken> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.')
  await ensureGoogleIdentityScript()
  const existing = await getStoredDriveReadonlyAuth()

  return new Promise<GoogleDriveAuthToken>((resolve, reject) => {
    let settled = false
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_READONLY_SCOPE,
      prompt: existing ? '' : 'consent',
      callback: async (response) => {
        if (settled) return
        settled = true
        if ((response as any).error || !response.access_token) {
          reject(new Error(`Drive 읽기 권한 요청 실패: ${(response as any).error || 'unknown'}`))
          return
        }
        const token: GoogleDriveAuthToken = {
          accessToken: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
          scope: response.scope || DRIVE_READONLY_SCOPE,
          tokenType: response.token_type || 'Bearer',
        }
        await dbSet(KEY_DRIVE_READONLY_AUTH, token)
        resolve(token)
      },
      error_callback: (error) => {
        if (settled) return
        settled = true
        const type = error?.type || 'unknown'
        if (type === 'popup_closed') {
          reject(new Error('Google 로그인 팝업이 닫혔습니다.'))
          return
        }
        reject(new Error(`Drive 읽기 권한 요청 실패: ${type}`))
      },
    })
    tokenClient.requestAccessToken()
  })
}

export async function ensureDriveReadonlyToken(): Promise<string> {
  const token = await getStoredDriveReadonlyAuth()
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken
  const refreshed = await requestDriveReadonlyToken()
  return refreshed.accessToken
}

/** 유저의 Drive에서 스프레드시트 목록 반환 (최근 수정순, 최대 30개) */
export async function listSpreadsheetFiles(): Promise<SpreadsheetFileInfo[]> {
  const token = await ensureDriveReadonlyToken()
  const query = new URLSearchParams({
    q: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name,modifiedTime)',
    pageSize: '30',
    orderBy: 'modifiedTime desc',
  })
  const payload = await fetchDriveJson(`files?${query.toString()}`, token)
  return Array.isArray(payload?.files) ? (payload.files as SpreadsheetFileInfo[]) : []
}

/** 스프레드시트를 CSV 텍스트로 내보내기 (첫 번째 시트 기준) */
export async function exportSheetAsCsv(fileId: string): Promise<string> {
  const token = await ensureDriveReadonlyToken()
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fcsv`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`스프레드시트 CSV 내보내기 실패 (${response.status})${text ? `: ${text}` : ''}`)
  }
  return response.text()
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

async function listAllBackupFiles(token: string): Promise<RawFileInfo[]> {
  // Drive API contains 는 토큰 단위 매칭을 하므로 클라이언트에서 정확히 필터링한다
  const query = new URLSearchParams({
    spaces: 'appDataFolder',
    q: 'trashed=false',
    fields: 'files(id,name,modifiedTime,size)',
    pageSize: '30',
    orderBy: 'modifiedTime desc',
  })
  const payload = await fetchDriveJson(`files?${query.toString()}`, token)
  const files: RawFileInfo[] = Array.isArray(payload?.files) ? (payload.files as RawFileInfo[]) : []
  return files.filter(
    (f) => f.name === BACKUP_LATEST_NAME || f.name.startsWith(BACKUP_DATED_PREFIX),
  )
}

async function uploadSingleFile(
  token: string,
  jsonText: string,
  fileName: string,
  existingId?: string,
): Promise<{ fileId: string; modifiedTime: string }> {
  const metadata = existingId ? { name: fileName } : { name: fileName, parents: ['appDataFolder'] }
  const { boundary, body } = buildMultipartBody(metadata, jsonText)
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,modifiedTime`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime'
  const response = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Drive 업로드 실패 (${response.status})${text ? `: ${text}` : ''}`)
  }
  const payload = await response.json()
  return {
    fileId: String(payload?.id || existingId || ''),
    modifiedTime: String(payload?.modifiedTime || new Date().toISOString()),
  }
}

async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Drive 파일 삭제 실패 (${response.status})`)
  }
}

function deriveBackupLabel(name: string): string {
  if (name === BACKUP_LATEST_NAME) return '최신 백업'
  const base = name.replace(BACKUP_DATED_PREFIX, '').replace(/\.json$/, '')
  if (base.startsWith('pre-reset_')) {
    const dt = base.replace('pre-reset_', '').replace('T', ' ').replace(/(\d{2})(\d{2})(\d{2})$/, '$1:$2:$3')
    return `초기화 전 백업 (${dt})`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(base)) return `${base} 일별 백업`
  return base
}

// ─── 회전 백업 (신규 방식) ───────────────────────────────────────────────────

/**
 * 상시 백업 및 히스토리 로테이션.
 * - vaulter_backup_latest.json    항상 최신 상태로 덮어씀
 * - vaulter_backup_YYYY-MM-DD.json  날짜별 스냅샷 (tag 없을 때)
 * - vaulter_backup_{tag}_YYYYMMDDTHHmmss.json  태그 백업 (e.g. 'pre-reset')
 * - 날짜별 파일이 MAX_DATED_BACKUPS 초과 시 가장 오래된 것부터 삭제
 */
export async function uploadRotatedBackup(
  snapshot: unknown,
  tag?: string,
): Promise<{ modifiedTime: string }> {
  const token = await ensureDriveAccessToken(false)
  const jsonText = JSON.stringify(snapshot, null, 2)

  const existing = await listAllBackupFiles(token)

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '')
  const datedName = tag
    ? `${BACKUP_DATED_PREFIX}${tag}_${dateStr}T${timeStr}.json`
    : `${BACKUP_DATED_PREFIX}${dateStr}.json`

  const latestFile = existing.find((f) => f.name === BACKUP_LATEST_NAME)
  const datedFile = existing.find((f) => f.name === datedName)

  const [latestResult] = await Promise.all([
    uploadSingleFile(token, jsonText, BACKUP_LATEST_NAME, latestFile?.id),
    uploadSingleFile(token, jsonText, datedName, datedFile?.id),
  ])

  // 날짜별 파일만 대상으로 로테이션 (latest 제외)
  const datedFiles = existing
    .filter((f) => f.name !== BACKUP_LATEST_NAME)
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())

  const willExistCount = datedFile ? datedFiles.length : datedFiles.length + 1
  if (willExistCount > MAX_DATED_BACKUPS) {
    const excess = willExistCount - MAX_DATED_BACKUPS
    const toDelete = datedFiles.filter((f) => f.name !== datedName).slice(-excess)
    await Promise.all(toDelete.map((f) => deleteDriveFile(token, f.id).catch(() => {})))
  }

  await dbSet(KEY_LAST_BACKUP_AT, new Date(latestResult.modifiedTime).getTime())
  if (latestResult.fileId) await dbSet(KEY_BACKUP_FILE_ID, latestResult.fileId)

  return { modifiedTime: latestResult.modifiedTime }
}

/** 백업 파일 목록 조회 (최신순) — 설정 UI 히스토리용 */
export async function listBackupFiles(): Promise<BackupFileInfo[]> {
  const token = await ensureDriveAccessToken(false)
  const files = await listAllBackupFiles(token)
  return files
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    .map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      size: f.size ?? 0,
      label: deriveBackupLabel(f.name),
    }))
}

/** 특정 백업 파일 다운로드 (fileId 기반) */
export async function downloadBackupById(fileId: string): Promise<unknown> {
  const token = await ensureDriveAccessToken(false)
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`백업 다운로드 실패 (${response.status})${text ? `: ${text}` : ''}`)
  }
  return response.json()
}

// ─── 구 단일 파일 방식 (하위 호환) ─────────────────────────────────────────

export async function uploadBackupSnapshot(snapshot: unknown): Promise<{ modifiedTime: string }> {
  const token = await ensureDriveAccessToken(false)
  const jsonText = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2)
  const existing = await findBackupFile(token)
  const metadata = existing
    ? { name: BACKUP_FILE_NAME }
    : { name: BACKUP_FILE_NAME, parents: ['appDataFolder'] }
  const { boundary, body } = buildMultipartBody(metadata, jsonText)
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,modifiedTime`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime'
  const response = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`개인 백업금고 업로드 실패 (${response.status})${text ? `: ${text}` : ''}`)
  }

  const payload = await response.json()
  const fileId = String(payload?.id || existing?.id || '')
  const modifiedTime = String(payload?.modifiedTime || new Date().toISOString())
  if (fileId) {
    await dbSet(KEY_BACKUP_FILE_ID, fileId)
  }
  await dbSet(KEY_LAST_BACKUP_AT, new Date(modifiedTime).getTime())
  return { modifiedTime }
}

export async function downloadBackupSnapshot(): Promise<{ snapshot: unknown; modifiedTime: string }> {
  const token = await ensureDriveAccessToken(false)
  const existing = await findBackupFile(token)
  if (!existing?.id) {
    throw new Error('개인 백업금고에 저장된 스냅샷이 아직 없습니다.')
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existing.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`백업 스냅샷 다운로드 실패 (${response.status})${text ? `: ${text}` : ''}`)
  }

  const snapshot = await response.json()
  return {
    snapshot,
    modifiedTime: existing.modifiedTime,
  }
}
