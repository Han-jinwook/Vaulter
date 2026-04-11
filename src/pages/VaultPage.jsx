import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

const initialDocs = [
  { id: 'doc-1', name: '전세계약서_원본.pdf', type: '계약서', updatedAt: '2026.04.06', status: '완료', size: '2.3 MB', isParsing: false },
  { id: 'doc-2', name: '차량보험_보증서.pdf', type: '보증서', updatedAt: '2026.04.02', status: '완료', size: '1.1 MB', isParsing: false },
  { id: 'doc-3', name: '연말정산_소득공제.zip', type: '세무', updatedAt: '2026.03.28', status: '검토 필요', size: '8.9 MB', isParsing: false },
  { id: 'doc-4', name: '아파트 관리비_2026-03.pdf', type: '명세서', updatedAt: '2026.03.26', status: '완료', size: '0.9 MB', isParsing: false },
]

const filters = ['전체', '계약서', '보증서', '세무', '명세서']
const cardTone = {
  계약서: 'from-[#232323] via-[#272727] to-[#212121]',
  보증서: 'from-[#252525] via-[#232323] to-[#1f1f1f]',
  세무: 'from-[#242424] via-[#222222] to-[#1f1f1f]',
  명세서: 'from-[#262626] via-[#232323] to-[#202020]',
}

export default function VaultPage() {
  const openUploadModal = useUIStore((s) => s.openUploadModal)
  const navigate = useNavigate()
  const [active, setActive] = useState('전체')
  const [docs] = useState(initialDocs)
  const [openedDoc, setOpenedDoc] = useState(null)
  const visibleDocs = docs.filter((d) => active === '전체' || d.type === active)
  const reviewCount = docs.filter((d) => d.status !== '완료').length

  const handleDeposit = () => {
    openUploadModal()
    navigate('/')
  }

  return (
    <>
      <section className="bg-[#121212] rounded-xl p-8 shadow-[0_12px_40px_rgba(0,0,0,0.45)] border border-[#26334D]/25">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <p className="text-xs text-[#595959] font-bold tracking-widest uppercase">비밀금고</p>
            <h1 className="text-3xl md:text-4xl font-extrabold mt-1 text-[#EDEDED]">원본/증빙 보관함</h1>
            <p className="text-xs text-[#595959] mt-2">당신의 가장 소중한 자산 증빙을 안전하게 암호화하여 보관합니다.</p>
          </div>
          <button
            onClick={handleDeposit}
            className="px-4 py-2 rounded-full bg-gradient-to-r from-[#FFD700] via-[#FFEA70] to-[#FFD700] text-[#121212] text-sm font-bold shadow-[0_0_18px_rgba(255,215,0,0.34)] hover:shadow-[0_0_28px_rgba(255,234,112,0.55)] transition-all"
          >
            새 문서 입금
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-2xl bg-[#232323] border border-[#26334D]/20 p-4 backdrop-blur-sm">
            <p className="text-[10px] text-[#595959] font-bold mb-1">보관 문서 수</p>
            <p className="text-2xl font-extrabold tabular-nums text-[#EDEDED]">{docs.length}건</p>
          </div>
          <div className="rounded-2xl bg-[#232323] border border-[#26334D]/20 p-4 backdrop-blur-sm">
            <p className="text-[10px] text-[#595959] font-bold mb-1">금고 사용량</p>
            <p className="text-2xl font-extrabold tabular-nums text-[#EDEDED]">2.8 GB</p>
            <div className="w-full h-2 rounded-full bg-[#1b1b1b] mt-2 overflow-hidden">
              <div
                className="h-full rounded-full shadow-[0_0_12px_rgba(255,215,0,0.45)]"
                style={{ width: '56%', background: 'linear-gradient(90deg, #FFD700 0%, #FFEA70 60%, #FFD700 100%)' }}
              />
            </div>
          </div>
          <div className="rounded-2xl bg-[#232323] border border-[#26334D]/20 p-4 backdrop-blur-sm">
            <p className="text-[10px] text-[#595959] font-bold mb-1">검토 필요 문서</p>
            <p className="text-2xl font-extrabold tabular-nums text-[#EDEDED]">{reviewCount}건</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActive(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
                active === f
                  ? 'bg-[#1C3A36] text-[#EDEDED]'
                  : 'bg-[#232323] text-[#595959] border border-[#26334D]/20 hover:text-[#EDEDED]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {visibleDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setOpenedDoc(doc)}
                className={`text-left rounded-2xl border border-[#FFD700]/40 p-5 bg-gradient-to-br backdrop-blur-sm ${
                  cardTone[doc.type] || cardTone.명세서
                } shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:border-[#FFEA70]/80 hover:shadow-[0_0_0_1px_rgba(255,234,112,0.55),0_0_28px_rgba(255,234,112,0.34)] hover:scale-[1.015] transition-all duration-300`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="material-symbols-outlined text-[#FFEA70] drop-shadow-[0_0_6px_rgba(255,234,112,0.35)]">lock</span>
                  <span className={`text-[11px] font-bold ${doc.status === '완료' ? 'text-[#A9B4C7]' : 'text-[#FFD166]'}`}>
                    {doc.status}
                  </span>
                </div>

                <p className="font-bold leading-snug min-h-[44px] text-[#EDEDED]">{doc.name}</p>
                <p className="text-xs text-[#595959] mt-1">{doc.type} · {doc.size}</p>
                <div className="mt-4 pt-3 border-t border-[#26334D]/20 flex items-center justify-between text-xs">
                  <span className="text-[#595959]">보관일</span>
                  <span className="tabular-nums text-[#EDEDED]">{doc.updatedAt}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {openedDoc && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
          <div className="w-full max-w-4xl bg-[#121212] rounded-2xl shadow-2xl overflow-hidden border border-[#26334D]/30">
            <div className="px-6 py-4 border-b border-[#26334D]/25 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg text-[#EDEDED]">문서 시네마 모드</h3>
                <p className="text-xs text-[#595959]">{openedDoc.name}</p>
              </div>
              <button
                onClick={() => setOpenedDoc(null)}
                className="w-9 h-9 rounded-full bg-[#232323] text-[#EDEDED] flex items-center justify-center hover:bg-[#26334D] transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6">
              <div className="h-[52vh] rounded-xl bg-gradient-to-br from-[#232323] to-[#1b1b1b] border border-[#26334D]/30 flex items-center justify-center">
                <div className="text-center">
                  <span className="material-symbols-outlined text-5xl text-[#8D95A3] mb-2">gpp_good</span>
                  <p className="font-bold text-[#EDEDED]">문서 미리보기 영역 (Theater Mode Skeleton)</p>
                  <p className="text-sm text-[#595959] mt-1">다음 단계에서 PDF/이미지 뷰어 연결</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

