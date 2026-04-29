import { create } from 'zustand'

export const useUIStore = create((set) => ({
  isUploadOpen: false,
  isUploadModalOpen: false,
  isCreditModalOpen: false,
  isSettingsModalOpen: false,
  isChatPanelOpen: true,
  isLeftExpanded: true,
  isChartMode: false,
  gmailSyncPhase: 'idle',
  gmailSyncStatus: '',
  gmailConnectState: 'idle',
  lastGmailSyncAt: null,
  driveBackupPhase: 'idle',
  driveBackupStatus: '',
  driveBackupConnected: false,
  lastDriveBackupAt: null,
  /** Gmail 기록 초기화 완료 배지 만료 시각(ms). remount에도 유지되도록 스토어에 둔다. */
  gmailHistoryClearedUntil: null,

  openUpload: () => set({ isUploadOpen: true, isUploadModalOpen: true }),
  closeUpload: () => set({ isUploadOpen: false, isUploadModalOpen: false }),
  openUploadModal: () => set({ isUploadOpen: true, isUploadModalOpen: true }),
  closeUploadModal: () => set({ isUploadOpen: false, isUploadModalOpen: false }),
  openCreditModal: () => set({ isCreditModalOpen: true }),
  closeCreditModal: () => set({ isCreditModalOpen: false }),
  openSettingsModal: () => set({ isSettingsModalOpen: true }),
  closeSettingsModal: () => set({ isSettingsModalOpen: false }),
  openChatPanel: () => set({ isChatPanelOpen: true }),
  closeChatPanel: () => set({ isChatPanelOpen: false }),

  openVizMode: () => set({ isLeftExpanded: false, isChartMode: true }),
  restoreTrinityMode: () => set({ isLeftExpanded: true, isChartMode: false }),
  setGmailSyncState: (phase, status = '') =>
    set({
      gmailSyncPhase: phase || 'idle',
      gmailSyncStatus: status || '',
    }),
  setGmailConnectState: (connectState = 'idle') =>
    set({
      gmailConnectState: connectState || 'idle',
    }),
  setGmailSyncStatus: (status) =>
    set({
      gmailSyncStatus: status || '',
      gmailSyncPhase: status ? 'reading' : 'idle',
    }),
  setLastGmailSyncAt: (timestamp) => set({ lastGmailSyncAt: timestamp || null }),
  setDriveBackupState: (phase, status = '', connected) =>
    set((state) => ({
      driveBackupPhase: phase || 'idle',
      driveBackupStatus: status || '',
      driveBackupConnected: typeof connected === 'boolean' ? connected : state.driveBackupConnected,
    })),
  setLastDriveBackupAt: (timestamp) => set({ lastDriveBackupAt: timestamp || null }),

  markGmailHistoryClearComplete: (durationMs = 12000) =>
    set({ gmailHistoryClearedUntil: Date.now() + Math.max(3000, durationMs) }),

  clearGmailHistoryClearBadge: () => set({ gmailHistoryClearedUntil: null }),

  // AI 비서가 query_ledger 실행 시 원장 필터링에 사용
  // null = 필터 없음, object = { label, ids } 형태
  aiFilter: null,
  setAiFilter: (filter) => set({ aiFilter: filter }),
  clearAiFilter: () => set({ aiFilter: null }),

  // AI render_visualization 호출 시 차트 기간 지정
  // null = 차트 내 토글 버튼 사용, { startDate, endDate, label } = AI 지정 기간
  vizFilter: null,
  setVizFilter: (f) => set({ vizFilter: f }),
  clearVizFilter: () => set({ vizFilter: null }),

  /** 원장 검토 필요 클릭 → 지기 채팅 해당 대화 블록으로 스크롤 */
  ledgerChatScrollRequest: null,
  requestLedgerChatScrollToTx: (txId) =>
    set((state) =>
      txId == null || String(txId).trim() === ''
        ? { ledgerChatScrollRequest: null }
        : {
            isChatPanelOpen: true,
            ledgerChatScrollRequest: {
              txId: String(txId),
              nonce: (state.ledgerChatScrollRequest?.nonce ?? 0) + 1,
            },
          },
    ),
  clearLedgerChatScrollRequest: () => set({ ledgerChatScrollRequest: null }),
  setVaultTheaterRequest: (payload) => set({ vaultTheaterRequest: payload }),
  clearVaultTheaterRequest: () => set({ vaultTheaterRequest: null }),
}))
