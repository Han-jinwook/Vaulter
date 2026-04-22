import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useVaultStore } from '../../stores/vaultStore'
import { useAssetStore, selectAssetLines } from '../../stores/assetStore'
import { selectLedgerCumulativeBalance } from '../../selectors/vaultSelectors'
import { CHAT_PANEL_ASIDE_LAYOUT } from './chatPanelAsideLayout'
import IsolatedChatComposer from './IsolatedChatComposer'
import { parseYmdOrToday } from '../../lib/ymdDate'
import { normalizeCategoryForType } from '../../lib/goldenAssetCategories'

const CTA_TAG = /\s*\[CTA:keeper\]\s*/i

function formatDateLabel(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

/** 자산/부채/총액·포트폴리오 질의는 API로 보냄(바이패스). 일상 소비/원장만 가드 */
function looksLikeDailyLedgerIntent(text) {
  const t = String(text || '')
  if (t.includes('자산') || t.includes('총액') || t.includes('부채')) return false
  const q = t.trim()
  if (!q) return false
  if (
    /(자산|부채|순자산|총액|총\s*평가|포트폴리오|평가|투자\s*잔|금융|etf|주식|채권|부동산|대출|마이너스|보유|net\s*asset|재테크|순자|재무)/i.test(
      q,
    )
  ) {
    return false
  }
  if (
    /(식비|커피|카페|점심|저녁|야식|국밥|스타벅스|맥주|배달|배민|요기요|마트|편의점|쿠팡|라떼|아메리카노|치킨|떡볶이|간식|구독|페이)/.test(
      q,
    )
  ) {
    return true
  }
  if (/(영수증|가계부|지기\)|지기로|지기에|지기랑|지기\(|지기는|지기를|지기에다|원장\s*에|원장에|원장만)/i.test(q)) {
    return true
  }
  if (/이번\s*달\s*지출|이번달\s*지출|한\s*달\s*지출|이번\s*달\s*쓴|월\s*지출|이번\s*달\s*나간/.test(q)) {
    return true
  }
  if (/(?:오늘|어제|그제|방금).{0,20}(쓴|썼|샀|지출|먹었|마셨|결제|질렀|탕진)/.test(q)) {
    return true
  }
  if (/(?:지출\s*얼마|얼마\??\s*나갔|뭐\s*썼|뭐.*써|어디.*써|한\s*달.*얼마.*써|카드.*얼마)/.test(q)) {
    return true
  }
  if (/^국밥|국밥[\s(（]/.test(q) || /국밥.*원|국밥.*처리|국밥.*넣|국밥.*식비/.test(q)) {
    return true
  }
  return false
}

function buildAssetContextForApi() {
  const lineRows = useAssetStore.getState().lines
  const transactions = useVaultStore.getState().transactions
  const liq = selectLedgerCumulativeBalance(transactions)
  const assets = selectAssetLines(lineRows, 'ASSET')
  const debts = selectAssetLines(lineRows, 'DEBT')
  const sumA = assets.reduce((s, a) => s + a.amount, 0)
  const sumD = debts.reduce((s, d) => s + d.amount, 0)
  const totalNet = liq + sumA - sumD
  return {
    lines: lineRows.map((l) => ({
      id: l.id,
      type: l.type,
      category: l.category,
      name: l.name,
      amount: l.amount,
      asOfDate: l.asOfDate,
      memo: l.memo,
      historyLength: Array.isArray(l.history) ? l.history.length : 0,
    })),
    systemInfo: {
      cumulativeLiquidityWon: liq,
      sumRegisteredAssetsWon: sumA,
      sumRegisteredDebtsWon: sumD,
      totalNetWon: totalNet,
    },
  }
}

function assetMessagesToApiMessages(msgs) {
  return msgs
    .filter((m) => m.type === 'text' || !m.type)
    .filter((m) => m.role === 'user' || m.role === 'ai')
    .map((m) => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: String(m.text || '').replace(CTA_TAG, '').trim(),
    }))
    .filter((m) => m.content)
}

export default function AssetChatPanel() {
  const assetMessages = useVaultStore((s) => s.assetMessages)
  const addAssetChatMessage = useVaultStore((s) => s.addAssetChatMessage)
  const addAsset = useAssetStore((s) => s.addAsset)
  const updateAsset = useAssetStore((s) => s.updateAsset)
  const deleteAsset = useAssetStore((s) => s.deleteAsset)

  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLabel, setThinkingLabel] = useState('생각하는 중...')
  const msgContainerRef = useRef(null)
  const conversationRef = useRef([])
  const prevMsgCountRef = useRef(assetMessages.length)

  const INITIAL_LOAD = 30
  const LOAD_MORE = 20
  const [displayCount, setDisplayCount] = useState(INITIAL_LOAD)
  const prevScrollHeightRef = useRef(null)
  const loadingMoreRef = useRef(false)

  const [headerDate, setHeaderDate] = useState(() => {
    const last = assetMessages[assetMessages.length - 1]
    return last ? formatDateLabel(last.createdAt || new Date().toISOString()) : ''
  })

  const initialMsgIdsRef = useRef(null)
  if (initialMsgIdsRef.current === null) {
    initialMsgIdsRef.current = new Set(assetMessages.map((m) => m.id))
  }

  const totalMsgCount = assetMessages.length
  const sliceStart = Math.max(0, totalMsgCount - displayCount)
  const visibleMessages = assetMessages.slice(sliceStart)
  const hasOlderMessages = sliceStart > 0

  const scrollChatToBottom = useCallback((smooth = true) => {
    const el = msgContainerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [])

  const syncHeaderDate = useCallback(() => {
    const container = msgContainerRef.current
    if (!container) return
    const els = container.querySelectorAll('[data-msg-date]')
    const containerTop = container.getBoundingClientRect().top
    for (const el of els) {
      if (el.getBoundingClientRect().top >= containerTop) {
        const d = el.getAttribute('data-msg-date')
        if (d) setHeaderDate(d)
        return
      }
    }
  }, [])

  useEffect(() => {
    scrollChatToBottom(false)
    requestAnimationFrame(() => syncHeaderDate())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    if (assetMessages.length === 0) return
    const run = () => {
      scrollChatToBottom(false)
      syncHeaderDate()
    }
    run()
    const id = requestAnimationFrame(() => {
      run()
      requestAnimationFrame(run)
    })
    return () => cancelAnimationFrame(id)
  }, [assetMessages.length, scrollChatToBottom, syncHeaderDate])

  useEffect(() => {
    if (loadingMoreRef.current && prevScrollHeightRef.current !== null) {
      const el = msgContainerRef.current
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = null
      loadingMoreRef.current = false
      syncHeaderDate()
    }
  }, [displayCount, syncHeaderDate])

  useEffect(() => {
    const isNewMessage = assetMessages.length > prevMsgCountRef.current
    prevMsgCountRef.current = assetMessages.length
    if (!loadingMoreRef.current && (isNewMessage || isThinking)) {
      scrollChatToBottom(isNewMessage)
    }
  }, [assetMessages, isThinking, scrollChatToBottom])

  const handleMsgScroll = useCallback(() => {
    const el = msgContainerRef.current
    if (!el) return
    syncHeaderDate()
    if (!loadingMoreRef.current && hasOlderMessages && el.scrollTop < 60) {
      prevScrollHeightRef.current = el.scrollHeight
      loadingMoreRef.current = true
      setDisplayCount((prev) => Math.min(prev + LOAD_MORE, totalMsgCount))
    }
  }, [hasOlderMessages, totalMsgCount, syncHeaderDate])

  const pushAssistantReply = useCallback(
    (rawText) => {
      const hasCta = CTA_TAG.test(rawText)
      const clean = String(rawText || '').replace(CTA_TAG, '').trim()
      addAssetChatMessage({
        role: 'ai',
        type: 'text',
        text: clean || '처리했습니다.',
        ...(hasCta ? { cta: { label: '지기(Keeper)로 이동', to: '/' } } : {}),
      })
    },
    [addAssetChatMessage],
  )

  const executeTool = useCallback(
    async (toolName, args) => {
      if (toolName === 'defer_to_keeper') {
        return { ok: true, note: '지기(Keeper) 안내는 모델 최종 답변의 [CTA:keeper]로 표시' }
      }
      if (toolName === 'add_asset_item') {
        const type = args.type === 'DEBT' ? 'DEBT' : 'ASSET'
        const category = normalizeCategoryForType(type, String(args.category ?? ''))
        const name = String(args.name || '').trim() || '이름 없음'
        const amount = Math.max(0, Math.round(Number(args.amount) || 0))
        const rawMemo = args.memo != null ? String(args.memo).trim() : ''
        const memo = rawMemo ? rawMemo : undefined
        const asOfDate = parseYmdOrToday(args.date)
        await addAsset({ type, category, name, amount, memo, asOfDate })
        return { success: true, added: { type, category, name, amount, memo, asOfDate } }
      }
      if (toolName === 'update_asset_item') {
        const id = String(args.id || '').trim()
        if (!id) return { success: false, error: 'id가 필요합니다.' }
        const ymd = parseYmdOrToday(args.date)
        const patch = {}
        if (args.type === 'ASSET' || args.type === 'DEBT') patch.type = args.type
        if (args.category != null) patch.category = String(args.category)
        if (args.name != null) patch.name = String(args.name)
        if (args.amount != null) patch.amount = Math.max(0, Math.round(Number(args.amount)))
        if (args.memo !== undefined) patch.memo = String(args.memo)
        if (Object.keys(patch).length === 0) return { success: false, error: '변경할 필드가 없습니다.' }
        patch.asOfDate = ymd
        await updateAsset(id, patch)
        return { success: true, id, patch }
      }
      if (toolName === 'delete_asset_item') {
        const id = String(args.id || '').trim()
        if (!id) return { success: false, error: 'id가 필요합니다.' }
        await deleteAsset(id)
        return { success: true, id }
      }
      return { error: `알 수 없는 도구: ${toolName}` }
    },
    [addAsset, updateAsset, deleteAsset],
  )

  const executeAssetAiChat = useCallback(
    async (userText) => {
      conversationRef.current = assetMessagesToApiMessages(useVaultStore.getState().assetMessages)

      addAssetChatMessage({ role: 'user', type: 'text', text: userText })
      conversationRef.current.push({ role: 'user', content: userText })

      if (looksLikeDailyLedgerIntent(userText)) {
        addAssetChatMessage({
          role: 'ai',
          type: 'text',
          text: '고객님, 일상 지출 내역 관리는 [지기(Keeper)] 탭에서 도와드리고 있습니다. 이동하시겠습니까?',
          cta: { label: '지기(Keeper)로 이동', to: '/' },
        })
        conversationRef.current.push({
          role: 'assistant',
          content:
            '고객님, 일상 지출 내역 관리는 [지기(Keeper)] 탭에서 도와드리고 있습니다. 이동하시겠습니까?\n[CTA:keeper]',
        })
        return
      }

      setIsThinking(true)
      setThinkingLabel('생각하는 중...')

      try {
        let safetyBreaker = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (++safetyBreaker > 8) throw new Error('응답 루프가 너무 깁니다.')

          const assetContext = buildAssetContextForApi()

          const res = await fetch('/api/chat-assistant-assets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: conversationRef.current,
              assetContext,
            }),
          })

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}))
            throw new Error(errData?.error || `서버 오류 (${res.status})`)
          }

          const data = await res.json()

          if (data.type === 'tool_call') {
            conversationRef.current.push(data.assistantMessage)

            for (const call of data.calls) {
              const toolName = call.function.name
              let args
              try {
                args = JSON.parse(call.function.arguments)
              } catch {
                args = {}
              }

              if (toolName === 'add_asset_item') setThinkingLabel('자산을 등록하는 중...')
              else if (toolName === 'update_asset_item') setThinkingLabel('자산을 수정하는 중...')
              else if (toolName === 'delete_asset_item') setThinkingLabel('자산을 삭제하는 중...')
              else if (toolName === 'defer_to_keeper') setThinkingLabel('지기 탭을 안내하는 중...')

              const toolResult = await executeTool(toolName, args)

              conversationRef.current.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolResult),
              })
            }

            setThinkingLabel('답변을 정리하는 중...')
            continue
          }

          if (data.type === 'reply') {
            pushAssistantReply(data.text)
            conversationRef.current.push({ role: 'assistant', content: data.text })
            break
          }

          throw new Error('알 수 없는 응답 형식입니다.')
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '답변 중 오류가 발생했습니다.'
        addAssetChatMessage({ role: 'ai', type: 'text', text: `죄송합니다. ${msg}` })
      } finally {
        setIsThinking(false)
        setThinkingLabel('생각하는 중...')
      }
    },
    [addAssetChatMessage, executeTool, pushAssistantReply],
  )

  const onSendHandlerRef = useRef(executeAssetAiChat)
  onSendHandlerRef.current = executeAssetAiChat
  const stableOnSend = useCallback((t) => onSendHandlerRef.current(t), [])

  return (
    <aside
      className={`${CHAT_PANEL_ASIDE_LAYOUT} mt-6 bg-gradient-to-b from-[#141414] to-[#0c0c0c] backdrop-blur-xl rounded-t-3xl rounded-b-2xl shadow-[0_12px_40px_rgba(0,0,0,0.55)] border border-[#FFD700]/25`}
    >
      <div className="px-4 py-3 border-b border-[#FFD700]/15 bg-[#121212]/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#3a2f12] to-[#1a1508] flex items-center justify-center shadow-md border border-[#FFD700]/35">
                <span
                  className="material-symbols-outlined text-[#F1C40F] text-[18px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  account_balance
                </span>
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-[#0c0c0c] rounded-full bg-[#D4AF37]" />
            </div>
            <h2 className="text-[15px] font-bold text-[#F5E6C8] tracking-tight">자산 관리 AI비서</h2>
          </div>
          {headerDate && (
            <span className="text-[10px] text-[#C9B87A]/90 font-medium shrink-0">{headerDate}</span>
          )}
        </div>
      </div>

      <div
        ref={msgContainerRef}
        onScroll={handleMsgScroll}
        className="flex-grow overflow-y-auto px-3 py-2 space-y-2 text-sm custom-scrollbar min-h-[220px]"
      >
        {hasOlderMessages && (
          <div className="text-center py-1">
            <span className="text-[10px] text-[#8a7a55]/80">위로 스크롤하면 이전 대화를 불러옵니다</span>
          </div>
        )}
        {visibleMessages.map((msg) => {
          const animate = !initialMsgIdsRef.current.has(msg.id)
          const msgDate = formatDateLabel(msg.createdAt || new Date().toISOString())
          const isUser = msg.role === 'user'
          return (
            <div key={msg.id} data-msg-date={msgDate} className={animate ? 'animate-fade-in' : ''}>
              <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[92%] rounded-2xl px-3 py-2 ${
                    isUser
                      ? 'bg-[#2a2412] text-[#f8efd0] border border-[#FFD700]/25 rounded-tr-sm'
                      : 'bg-[#1a1a1a] text-[#e8dcc8] border border-[#3d3520]/80 rounded-tl-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed text-[13px]">{msg.text}</p>
                  {msg.cta && (
                    <Link
                      to={msg.cta.to}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#1a1109] bg-gradient-to-r from-[#FFD700] to-[#C9A227] px-3 py-1.5 rounded-lg border border-[#FFD700]/40 hover:opacity-95 transition-opacity"
                    >
                      {msg.cta.label}
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  )}
                  <p className={`text-[10px] mt-1 tabular-nums ${isUser ? 'text-[#b9a574]/70' : 'text-[#8a7d66]/80'}`}>
                    {msg.time}
                  </p>
                </div>
              </div>
            </div>
          )
        })}

        {isThinking && (
          <div className="flex items-end gap-1.5 max-w-[94%] animate-fade-in">
            <div className="bg-[#1a1814] border border-[#FFD700]/20 px-3 py-2 rounded-2xl rounded-tl-none">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  <span
                    className="w-1.5 h-1.5 bg-[#FFD700] rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-[#C9A227] rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-[#8a7a55] rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                <span className="text-[#c9b89a] text-xs font-medium">{thinkingLabel}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <IsolatedChatComposer
        variant="asset"
        disabled={isThinking}
        thinkingLabel={thinkingLabel}
        idlePlaceholder="자산·부채 등록·수정·삭제를 말씀해 주세요."
        onSend={stableOnSend}
      />
    </aside>
  )
}
