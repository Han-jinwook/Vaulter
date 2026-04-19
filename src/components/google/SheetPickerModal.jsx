import { useEffect, useState } from 'react'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'
import { listSpreadsheetFiles, exportSheetAsCsv } from '../../lib/googleDriveSync'
import { parseCsvText } from '../../lib/documentParsers'
import { buildDocumentChunks } from '../../lib/documentChunking'
import { analyzeDocumentChunks } from '../../lib/visionAIEngine'

function formatModifiedTime(isoString) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SheetPickerModal({ isOpen, onClose }) {
  const { ingestDocumentAnalysisBatch, setLedgerAiReviewContext } = useVaultStore()
  const { openChatPanel } = useUIStore()

  const [phase, setPhase] = useState('idle') // idle | loading | list | processing | done | error
  const [sheets, setSheets] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const [progressLabel, setProgressLabel] = useState('')
  const [progressCurrent, setProgressCurrent] = useState(0)
  const [progressTotal, setProgressTotal] = useState(0)
  const [doneCount, setDoneCount] = useState(0)

  useEffect(() => {
    if (!isOpen) return
    setPhase('loading')
    setErrorMsg('')
    setSheets([])

    listSpreadsheetFiles()
      .then((files) => {
        setSheets(files)
        setPhase('list')
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : 'Drive 파일 목록을 불러오지 못했습니다.')
        setPhase('error')
      })
  }, [isOpen])

  const handleImport = async (sheet) => {
    setPhase('processing')
    setProgressCurrent(0)
    setProgressTotal(0)
    setProgressLabel('스프레드시트 다운로드 중...')

    try {
      const csvText = await exportSheetAsCsv(sheet.id)

      setProgressLabel('데이터 파싱 중...')
      const extraction = await parseCsvText(csvText, sheet.name)

      const chunks = buildDocumentChunks(extraction)
      if (!chunks.length) {
        throw new Error('분석할 데이터 행이 없습니다. 스프레드시트에 내용이 있는지 확인하세요.')
      }

      setProgressTotal(chunks.length)
      setProgressLabel(`AI 분석 중... (0 / ${chunks.length} 청크)`)

      const items = await analyzeDocumentChunks(chunks, (completed, total) => {
        setProgressCurrent(completed)
        setProgressLabel(`AI 분석 중... (${completed} / ${total} 청크)`)
      })

      const docId = `gsheet-${sheet.id}-${Date.now()}`
      const result = ingestDocumentAnalysisBatch(docId, sheet.name, items)

      if (!result.insertedCount) {
        throw new Error('원장에 추가할 거래 항목을 찾지 못했습니다. 날짜·금액 열이 있는지 확인하세요.')
      }

      setDoneCount(result.insertedCount)
      setPhase('done')
      setLedgerAiReviewContext()
      openChatPanel()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '가져오기 중 오류가 발생했습니다.')
      setPhase('error')
    }
  }

  const handleClose = () => {
    if (phase === 'processing') return
    onClose()
    setPhase('idle')
    setSheets([])
    setErrorMsg('')
    setProgressCurrent(0)
    setProgressTotal(0)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative z-10 bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/15">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F9D58]/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#0F9D58] text-xl">table_chart</span>
            </div>
            <div>
              <div className="font-bold text-on-surface">구글 스프레드시트 가져오기</div>
              <div className="text-xs text-on-surface-variant mt-0.5">Drive의 가계부 데이터를 한 번에 이사</div>
            </div>
          </div>
          {phase !== 'processing' && (
            <button onClick={handleClose} className="text-outline hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          {/* 로딩 */}
          {phase === 'loading' && (
            <div className="flex flex-col items-center py-10 gap-4">
              <span className="w-8 h-8 border-2 border-primary/60 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-on-surface-variant">Drive에서 스프레드시트 목록을 불러오는 중...</span>
            </div>
          )}

          {/* 시트 목록 */}
          {phase === 'list' && (
            <>
              {sheets.length === 0 ? (
                <div className="text-center py-10 text-on-surface-variant text-sm">
                  Drive에 스프레드시트 파일이 없습니다.
                </div>
              ) : (
                <>
                  <p className="text-xs text-on-surface-variant mb-3">
                    파일을 선택하면 첫 번째 시트를 CSV로 변환해 AI가 분석합니다.
                  </p>
                  <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                    {sheets.map((sheet) => (
                      <button
                        key={sheet.id}
                        onClick={() => handleImport(sheet)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-outline-variant/20 bg-surface-container-low hover:bg-primary/5 hover:border-primary/30 transition-all text-left group"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-on-surface truncate group-hover:text-primary transition-colors">
                            {sheet.name}
                          </div>
                          <div className="text-xs text-on-surface-variant mt-0.5">
                            수정: {formatModifiedTime(sheet.modifiedTime)}
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-outline group-hover:text-primary transition-colors shrink-0 ml-3">
                          arrow_forward
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* 처리 중 */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center py-8 gap-5">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <span className="w-8 h-8 border-[3px] border-primary/60 border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-center">
                <div className="font-semibold text-on-surface mb-1">{progressLabel}</div>
                {progressTotal > 0 && (
                  <div className="text-xs text-on-surface-variant">
                    데이터가 많으면 시간이 걸릴 수 있습니다.
                  </div>
                )}
              </div>
              {progressTotal > 0 && (
                <div className="w-full">
                  <div className="flex justify-between text-xs text-on-surface-variant mb-1.5">
                    <span>진행률</span>
                    <span>{progressCurrent} / {progressTotal}</span>
                  </div>
                  <div className="w-full bg-surface-container rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${progressTotal ? (progressCurrent / progressTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 완료 */}
          {phase === 'done' && (
            <div className="flex flex-col items-center py-8 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-green-600 text-4xl">check_circle</span>
              </div>
              <div>
                <div className="font-bold text-on-surface text-lg">가져오기 완료!</div>
                <div className="text-sm text-on-surface-variant mt-1">
                  <span className="font-bold text-primary">{doneCount}건</span>의 거래 내역이 원장에 추가되었습니다.
                </div>
                <div className="text-xs text-on-surface-variant mt-1">
                  AI 채팅 패널에서 항목·계정을 확인하세요.
                </div>
              </div>
              <button
                onClick={handleClose}
                className="mt-2 px-6 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:scale-105 transition-transform active:scale-95"
              >
                확인
              </button>
            </div>
          )}

          {/* 에러 */}
          {phase === 'error' && (
            <div className="flex flex-col items-center py-8 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-red-500 text-4xl">error</span>
              </div>
              <div>
                <div className="font-bold text-on-surface">가져오기 실패</div>
                <div className="text-sm text-red-600 mt-1 max-w-xs">{errorMsg}</div>
              </div>
              <button
                onClick={() => { setPhase('list'); setErrorMsg('') }}
                className="px-6 py-2.5 bg-surface-container text-on-surface rounded-xl font-bold text-sm"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
