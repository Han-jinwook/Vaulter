import { create } from 'zustand'

export const useUIStore = create((set) => ({
  isUploadOpen: false,
  isUploadModalOpen: false,
  isCreditModalOpen: false,
  isChatPanelOpen: true,
  isLeftExpanded: true,
  isChartMode: false,
  gmailSyncPhase: 'idle',
  gmailSyncStatus: '',
  lastGmailSyncAt: null,
  /** Gmail 기록 초기화 완료 배지 만료 시각(ms). remount에도 유지되도록 스토어에 둔다. */
  gmailHistoryClearedUntil: null,

  openUpload: () => set({ isUploadOpen: true, isUploadModalOpen: true }),
  closeUpload: () => set({ isUploadOpen: false, isUploadModalOpen: false }),
  openUploadModal: () => set({ isUploadOpen: true, isUploadModalOpen: true }),
  closeUploadModal: () => set({ isUploadOpen: false, isUploadModalOpen: false }),
  openCreditModal: () => set({ isCreditModalOpen: true }),
  closeCreditModal: () => set({ isCreditModalOpen: false }),
  openChatPanel: () => set({ isChatPanelOpen: true }),
  closeChatPanel: () => set({ isChatPanelOpen: false }),

  openVizMode: () => set({ isLeftExpanded: false, isChartMode: true }),
  restoreTrinityMode: () => set({ isLeftExpanded: true, isChartMode: false }),
  setGmailSyncState: (phase, status = '') =>
    set({
      gmailSyncPhase: phase || 'idle',
      gmailSyncStatus: status || '',
    }),
  setGmailSyncStatus: (status) =>
    set({
      gmailSyncStatus: status || '',
      gmailSyncPhase: status ? 'reading' : 'idle',
    }),
  setLastGmailSyncAt: (timestamp) => set({ lastGmailSyncAt: timestamp || null }),

  markGmailHistoryClearComplete: (durationMs = 12000) =>
    set({ gmailHistoryClearedUntil: Date.now() + Math.max(3000, durationMs) }),

  clearGmailHistoryClearBadge: () => set({ gmailHistoryClearedUntil: null }),
}))
