import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useVaultStore } from '../../stores/vaultStore'
import GoogleConnectModal from '../google/GoogleConnectModal'
import SheetPickerModal from '../google/SheetPickerModal'
import { getGoogleIntegrationStatus } from '../../lib/googleIntegration'
import { analyzeDocumentChunks } from '../../lib/visionAIEngine'
import { buildDocumentChunks } from '../../lib/documentChunking'
import { detectUploadFileKind, extractLocalDocument } from '../../lib/documentParsers'

const fileTypes = [
  { icon: 'picture_as_pdf', label: 'PDF', color: 'text-primary' },
  { icon: 'csv', label: 'CSV', color: 'text-secondary' },
  { icon: 'table_chart', label: 'XLS/XLSX', color: 'text-tertiary' },
  { icon: 'table_chart', label: 'Google Sheets', color: 'text-[#0F9D58]' },
]

export default function FileUploadOverlay() {
  const { closeUploadModal, openChatPanel } = useUIStore()
  const {
    isDragging,
    setDragging,
    analyzeDocumentWithVision,
    ingestDocumentAnalysisBatch,
    setLedgerAiReviewContext,
    askAboutTransaction,
  } = useVaultStore()
  const [isScanning, setIsScanning] = useState(false)
  const [scanLabel, setScanLabel] = useState('문서를 분석 중입니다...')
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false)
  const [isSheetPickerOpen, setIsSheetPickerOpen] = useState(false)
  const pendingFilesRef = useRef([])
  const fileInputRef = useRef(null)

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

  const processFiles = async (files = []) => {
    const selectedFiles = files.filter(Boolean)
    if (!selectedFiles.length) return

    setIsScanning(true)
    try {
      for (const file of selectedFiles) {
        const fakeDocumentId = `vault-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const parsedType = /세금|국세|고지서|tax/i.test(file.name) ? '세무' : '영수증'
        const fileKind = detectUploadFileKind(file)

        if (fileKind === 'unsupported') {
          throw new Error(`${file.name} 은(는) 아직 지원되지 않는 형식입니다.`)
        }

        if (fileKind === 'image') {
          setScanLabel(`이미지 분석 중: ${file.name}`)
          const txId = await analyzeDocumentWithVision(fakeDocumentId, file, parsedType)
          askAboutTransaction(txId)
          continue
        }

        setScanLabel(`문서 파싱 중: ${file.name}`)
        const extracted = await extractLocalDocument(file)
        const chunks = buildDocumentChunks(extracted)
        if (!chunks.length) {
          throw new Error(`${file.name} 에서 분석할 텍스트를 찾지 못했습니다.`)
        }

        setScanLabel(`문서 청크 분석 중: ${file.name} (${chunks.length}개)`)
        const parsedItems = await analyzeDocumentChunks(chunks)
        const inserted = ingestDocumentAnalysisBatch(fakeDocumentId, file.name, parsedItems)

        if (!inserted.insertedCount) {
          throw new Error(`${file.name} 에서 거래로 반영할 항목을 찾지 못했습니다.`)
        }
      }
      setScanLabel('문서를 분석 중입니다...')
      setLedgerAiReviewContext()
      openChatPanel()
      closeUploadModal()
      setDragging(false)
    } catch (error) {
      const msg = error instanceof Error ? error.message : '문서 분석 중 오류가 발생했습니다.'
      window.alert(`분석에 실패했습니다.\n${msg}`)
    } finally {
      setIsScanning(false)
      setScanLabel('문서를 분석 중입니다...')
    }
  }

  const runParsingFlow = async (files = []) => {
    const selectedFiles = files.filter(Boolean)
    if (!selectedFiles.length) return
    try {
      const integration = await getGoogleIntegrationStatus()
      if (!integration.combinedConnected) {
        pendingFilesRef.current = selectedFiles
        setIsGoogleModalOpen(true)
        return
      }
      await processFiles(selectedFiles)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Google 통합 상태를 확인하지 못했습니다.'
      window.alert(`업로드를 시작하지 못했습니다.\n${msg}`)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer?.files || [])
    runParsingFlow(files)
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 md:p-12 animate-fade-in"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <GoogleConnectModal
        isOpen={isGoogleModalOpen}
        onClose={() => setIsGoogleModalOpen(false)}
        onConnected={() => {
          const files = pendingFilesRef.current
          pendingFilesRef.current = []
          if (files.length) {
            processFiles(files)
          }
        }}
      />
      <SheetPickerModal
        isOpen={isSheetPickerOpen}
        onClose={() => {
          setIsSheetPickerOpen(false)
          closeUploadModal()
          setDragging(false)
        }}
      />
      {/* Backdrop */}
      <div className="absolute inset-0 bg-primary/10 backdrop-blur-md" onClick={close} />

      {/* Drop Zone */}
      <div className="relative w-full max-w-5xl h-[80vh] overflow-y-auto custom-scrollbar flex flex-col items-center justify-center rounded-xl bg-surface-container-lowest/90 backdrop-blur-xl p-12 text-center border-4 border-dashed border-primary/40">
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
          {isScanning ? 'AI가 업로드를 처리 중입니다...' : isDragging ? '바로 여기에 놓으세요!' : '파일을 금고에 넣으세요'}
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
        {!isScanning && (
          <div className="mb-8 max-w-2xl space-y-1 text-center">
            <p className="text-sm font-semibold text-on-surface-variant">
              지원 형식: 이미지 영수증, CSV, XLS/XLSX, 텍스트 레이어 PDF
            </p>
            <p className="text-xs text-outline">
              스캔형 PDF, 압축파일, 문서형 워드 파일은 아직 지원되지 않습니다. 개인 백업금고 연결은 설정에서 할 수 있습니다.
            </p>
          </div>
        )}

        {isScanning ? (
          <div className="flex items-center gap-3 mt-2 text-on-surface-variant">
          <span className="w-4 h-4 border-2 border-primary/70 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold">{scanLabel}</span>
          </div>
        ) : !isDragging && (
          <>
            <p className="text-on-surface-variant font-medium mb-4">또는</p>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-primary text-white py-4 px-10 rounded-full font-bold text-lg shadow-xl shadow-primary/20 hover:scale-105 transition-transform active:scale-95 flex items-center gap-3"
              >
                <span className="material-symbols-outlined">file_open</span>
                내 기기에서 파일 선택
              </button>
              <button
                onClick={() => setIsSheetPickerOpen(true)}
                className="bg-[#0F9D58] text-white py-4 px-8 rounded-full font-bold text-lg shadow-xl shadow-[#0F9D58]/20 hover:scale-105 transition-transform active:scale-95 flex items-center gap-3"
              >
                <span className="material-symbols-outlined">table_chart</span>
                구글 스프레드시트 가져오기
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                runParsingFlow(files)
                e.target.value = ''
              }}
            />
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
