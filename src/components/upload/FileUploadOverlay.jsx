import { useEffect, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'

const fileTypes = [
  { icon: 'picture_as_pdf', label: 'PDF', color: 'text-primary' },
  { icon: 'csv', label: 'CSV', color: 'text-secondary' },
  { icon: 'table_chart', label: 'XLSX', color: 'text-tertiary' },
]

export default function FileUploadOverlay() {
  const { closeUploadModal, openChatPanel } = useUIStore()
  const {
    isDragging,
    setDragging,
    simulateDocumentParsing,
    setLedgerAiReviewContext,
    askAboutTransaction,
  } = useVaultStore()
  const [isScanning, setIsScanning] = useState(false)

  const close = () => {
    if (isScanning) return
    closeUploadModal()
    setDragging(false)
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const runParsingFlow = async () => {
    setIsScanning(true)
    const fakeDocumentId = `vault-doc-${Date.now()}`
    const parsedType = Date.now() % 2 === 0 ? '세무' : '영수증'
    const txId = await simulateDocumentParsing(fakeDocumentId, parsedType)
    setLedgerAiReviewContext()
    openChatPanel()
    askAboutTransaction(txId)
    setIsScanning(false)
    closeUploadModal()
    setDragging(false)
    window.alert('데이터 추출 완료! 지기방(원장)에 검토 대기 내역이 추가되었습니다.')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    runParsingFlow()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12 animate-fade-in"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-primary/10 backdrop-blur-md" onClick={close} />

      {/* Drop Zone */}
      <div className="relative w-full max-w-5xl h-[80vh] flex flex-col items-center justify-center rounded-xl bg-surface-container-lowest/90 backdrop-blur-xl p-12 text-center border-4 border-dashed border-primary/40">
        {/* Close */}
        <button
          onClick={close}
          className="absolute top-8 right-8 w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center hover:bg-surface-container-highest transition-all active:scale-90"
        >
          <span className="material-symbols-outlined text-on-surface">close</span>
        </button>

        {/* Upload Icon */}
        <div className="relative mb-10">
          <div className="absolute inset-0 bg-primary/10 blur-[60px] rounded-full animate-pulse" />
          <div className="relative bg-gradient-to-tr from-primary to-primary-container w-36 h-36 md:w-48 md:h-48 rounded-full flex items-center justify-center shadow-2xl shadow-primary/30">
            <span className="material-symbols-outlined text-white" style={{ fontSize: '80px' }}>
              cloud_upload
            </span>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-3xl md:text-5xl font-black text-on-surface mb-6 tracking-tight">
          {isScanning ? 'AI가 문서를 스캔 중입니다...' : isDragging ? '바로 여기에 놓으세요!' : '파일을 금고에 넣으세요'}
        </h2>

        {/* File type badges */}
        <div className="flex flex-wrap justify-center gap-3 mb-10">
          {fileTypes.map((ft) => (
            <div key={ft.label} className="px-6 py-2 bg-surface-container-lowest rounded-full shadow-sm border border-outline-variant/20 flex items-center gap-2">
              <span className={`material-symbols-outlined ${ft.color} text-xl`}>{ft.icon}</span>
              <span className="font-bold text-sm">{ft.label}</span>
            </div>
          ))}
        </div>

        {isScanning ? (
          <div className="flex items-center gap-3 mt-2 text-on-surface-variant">
            <span className="w-4 h-4 border-2 border-primary/70 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-semibold">AI 스캐닝 중... 잠시만 기다려 주세요.</span>
          </div>
        ) : !isDragging && (
          <>
            <p className="text-on-surface-variant font-medium mb-4">또는</p>
            <button
              onClick={runParsingFlow}
              className="bg-primary text-white py-4 px-10 rounded-full font-bold text-lg shadow-xl shadow-primary/20 hover:scale-105 transition-transform active:scale-95 flex items-center gap-3"
            >
              <span className="material-symbols-outlined">file_open</span>
              내 기기에서 파일 선택
            </button>
          </>
        )}

        {/* Decorative */}
        <div className="absolute bottom-12 left-12 opacity-20 hidden lg:block">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '80px' }}>rocket_launch</span>
        </div>
        <div className="absolute top-12 left-12 opacity-20 hidden lg:block">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '60px' }}>security</span>
        </div>
      </div>
    </div>
  )
}
