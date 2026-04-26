import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useVaultStore } from '../../stores/vaultStore'
import { buildBudgetContextPayload } from '../../lib/budgetContextForApi'
import { CHAT_PANEL_ASIDE_LAYOUT } from './chatPanelAsideLayout'
import IsolatedChatComposer from './IsolatedChatComposer'
import { MessageWithActionLinks } from './MessageWithActionLinks'

const CTA_TAG = /\s*\[CTA:keeper\]\s*/i

function formatDateLabel(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

function budgetMessagesToApiMessages(msgs) {
  return msgs
    .filter((m) => m.type === 'text' || !m.type)
    .filter((m) => m.role === 'user' || m.role === 'ai')
    .map((m) => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: String(m.text || '').replace(CTA_TAG, '').trim(),
    }))
    .filter((m) => m.content)
}

/** 예산&목표 탭 전용 — `/api/chat-assistant-budget` 만 사용. AIChatPanel 과 공유하지 않음. */
export default function BudgetChatPanel() {
  const budgetMessages = useVaultStore((s) => s.budgetMessages)
  const addBudgetChatMessage = useVaultStore((s) => s.addBudgetChatMessage)

  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLabel, setThinkingLabel] = useState('분석 중...')
  const msgContainerRef = useRef(null)
  const conversationRef = useRef([])
  const prevMsgCountRef = useRef(budgetMessages.length)

  const INITIAL_LOAD = 30
  const LOAD_MORE = 20
  const [displayCount, setDisplayCount] = useState(INITIAL_LOAD)
  const prevScrollHeightRef = useRef(null)
  const loadingMoreRef = useRef(false)

  const [headerDate, setHeaderDate] = useState(() => {
    const last = budgetMessages[budgetMessages.length - 1]
    return last ? formatDateLabel(last.createdAt || new Date().toISOString()) : ''
  })

  const initialMsgIdsRef = useRef(null)
  if (initialMsgIdsRef.current === null) {
    initialMsgIdsRef.current = new Set(budgetMessages.map((m) => m.id))
  }

  const totalMsgCount = budgetMessages.length
  const sliceStart = Math.max(0, totalMsgCount - displayCount)
  const visibleMessages = budgetMessages.slice(sliceStart)
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
    if (budgetMessages.length === 0) return
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
  }, [budgetMessages.length, scrollChatToBottom, syncHeaderDate])

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
    const isNewMessage = budgetMessages.length > prevMsgCountRef.current
    prevMsgCountRef.current = budgetMessages.length
    if (!loadingMoreRef.current && (isNewMessage || isThinking)) {
      scrollChatToBottom(isNewMessage)
    }
  }, [budgetMessages, isThinking, scrollChatToBottom])

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
      addBudgetChatMessage({
        role: 'ai',
        type: 'text',
        text: clean || '말씀 주신 내용을 바탕으로 정리해 드리겠습니다.',
        ...(hasCta ? { cta: { label: '지기(Keeper)로 이동', to: '/' } } : {}),
      })
    },
    [addBudgetChatMessage],
  )

  const executeTool = useCallback(async (toolName, args) => {
    if (toolName === 'add_goal_item') {
      const title = String(args.title || '').trim() || '(제목 없음)'
      const targetAmount = Math.max(0, Math.round(Number(args.target_amount) || 0))
      const targetDate = String(args.target_date || '').trim() || ''
      const current =
        args.current_amount != null && args.current_amount !== ''
          ? Math.max(0, Math.round(Number(args.current_amount) || 0))
          : 0
      return {
        success: true,
        stub: true,
        message:
          '목표 항목 등록 요청을 수신했습니다(저장소 연동 전). 이후 버전에서 앱과 동기화됩니다.',
        received: { title, target_amount: targetAmount, target_date: targetDate, current_amount: current },
      }
    }
    return { error: `알 수 없는 도구: ${toolName}` }
  }, [])

  const runBudgetChat = useCallback(
    async (userText) => {
      conversationRef.current = budgetMessagesToApiMessages(useVaultStore.getState().budgetMessages)

      addBudgetChatMessage({ role: 'user', type: 'text', text: userText })
      conversationRef.current.push({ role: 'user', content: userText })

      setIsThinking(true)
      setThinkingLabel('분석 중...')

      try {
        let safetyBreaker = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (++safetyBreaker > 8) throw new Error('응답 루프가 너무 깁니다.')

          const res = await fetch('/api/chat-assistant-budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: conversationRef.current,
              assistantType: 'budget',
              budgetContext: buildBudgetContextPayload(),
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
              let a
              try {
                a = JSON.parse(call.function.arguments)
              } catch {
                a = {}
              }

              if (toolName === 'add_goal_item') setThinkingLabel('목표 항목 반영 중...')

              const toolResult = await executeTool(toolName, a)

              conversationRef.current.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolResult),
              })
            }

            setThinkingLabel('브리핑 정리 중...')
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
        addBudgetChatMessage({ role: 'ai', type: 'text', text: `죄송합니다. ${msg}` })
      } finally {
        setIsThinking(false)
        setThinkingLabel('분석 중...')
      }
    },
    [addBudgetChatMessage, executeTool, pushAssistantReply],
  )

  const onSendHandlerRef = useRef(runBudgetChat)
  onSendHandlerRef.current = runBudgetChat
  const stableOnSend = useCallback((t) => onSendHandlerRef.current(t), [])

  return (
    <aside
      className={`${CHAT_PANEL_ASIDE_LAYOUT} mt-6 bg-gradient-to-b from-[#111318] to-[#080a0e] backdrop-blur-xl rounded-t-3xl rounded-b-2xl shadow-[0_12px_40px_rgba(0,0,0,0.55)] border border-slate-500/25`}
    >
      <div className="px-4 py-3 border-b border-slate-500/20 bg-[#0c0e14]/90">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1e293b] to-[#0f172a] flex items-center justify-center shadow-md border border-slate-500/35">
                <span
                  className="material-symbols-outlined text-slate-200 text-[18px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  pie_chart
                </span>
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-[#080a0e] rounded-full bg-sky-500" />
            </div>
            <h2 className="text-[15px] font-bold text-slate-100 tracking-tight">예산·목표 CFO</h2>
          </div>
          {headerDate && (
            <span className="text-[10px] text-slate-400 font-medium shrink-0">{headerDate}</span>
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
            <span className="text-[10px] text-slate-500">위로 스크롤하면 이전 대화를 불러옵니다</span>
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
                      ? 'bg-[#1a2332] text-slate-100 border border-slate-500/30 rounded-tr-sm'
                      : 'bg-[#12151c] text-slate-200/95 border border-slate-600/40 rounded-tl-sm'
                  }`}
                >
                  <MessageWithActionLinks
                    text={msg.text}
                    className="text-[13px] leading-relaxed"
                    linkVariant="contrast"
                  />
                  {msg.cta && (
                    <Link
                      to={msg.cta.to}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-gradient-to-r from-sky-400 to-indigo-500 px-3 py-1.5 rounded-lg border border-sky-300/40 hover:opacity-95 transition-opacity"
                    >
                      {msg.cta.label}
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </Link>
                  )}
                  <p
                    className={`text-[10px] mt-1 tabular-nums ${
                      isUser ? 'text-slate-500' : 'text-slate-500/90'
                    }`}
                  >
                    {msg.time}
                  </p>
                </div>
              </div>
            </div>
          )
        })}

        {isThinking && (
          <div className="flex items-end gap-1.5 max-w-[94%] animate-fade-in">
            <div className="bg-[#0f1419] border border-slate-600/35 px-3 py-2 rounded-2xl rounded-tl-none">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  <span
                    className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                <span className="text-slate-400 text-xs font-medium">{thinkingLabel}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <IsolatedChatComposer
        variant="budget"
        disabled={isThinking}
        thinkingLabel={thinkingLabel}
        idlePlaceholder="월 결산·목표·예산 로드맵을 말씀해 주세요."
        onSend={stableOnSend}
      />
    </aside>
  )
}
