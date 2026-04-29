import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useVaultStore } from '../../stores/vaultStore'
import { useUIStore } from '../../stores/uiStore'
import { CHAT_PANEL_ASIDE_LAYOUT } from './chatPanelAsideLayout'
import IsolatedChatComposer from './IsolatedChatComposer'
import { MessageWithActionLinks } from './MessageWithActionLinks'
import VaultLockScreen from './VaultLockScreen'
import {
  isVaultPinConfigured,
  isVaultUnlockedThisSession,
} from '../../lib/vaultPinClient'
import { resolveApiUrl } from '../../lib/resolveApiUrl'

const CTA_TAG = /\s*\[CTA:keeper\]\s*/i

function formatDateLabel(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`
}

function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function vaultMessagesToApiMessages(msgs) {
  return msgs
    .filter((m) => m.type === 'text' || !m.type)
    .filter((m) => m.role === 'user' || m.role === 'ai')
    .map((m) => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: String(m.text || '').replace(CTA_TAG, '').trim(),
    }))
    .filter((m) => m.content)
}

/** 비밀금고 전용 — `/api/chat-assistant-vault` 만. AIChatPanel·다른 방과 state 미공유 */
export default function VaultChatPanel() {
  const vaultMessages = useVaultStore((s) => s.vaultMessages)
  const addVaultChatMessage = useVaultStore((s) => s.addVaultChatMessage)
  const addSecretVaultDocument = useVaultStore((s) => s.addSecretVaultDocument)
  const setVaultTheaterRequest = useUIStore((s) => s.setVaultTheaterRequest)

  const [pinError, setPinError] = useState('')
  const [needsLock, setNeedsLock] = useState(() => {
    if (typeof window === 'undefined') return false
    return isVaultPinConfigured() && !isVaultUnlockedThisSession()
  })

  const [isThinking, setIsThinking] = useState(false)
  const [thinkingLabel, setThinkingLabel] = useState('…')
  const msgContainerRef = useRef(null)
  const conversationRef = useRef([])
  const prevMsgCountRef = useRef(vaultMessages.length)

  const INITIAL_LOAD = 30
  const LOAD_MORE = 20
  const [displayCount, setDisplayCount] = useState(INITIAL_LOAD)
  const prevScrollHeightRef = useRef(null)
  const loadingMoreRef = useRef(false)

  const [headerDate, setHeaderDate] = useState(() => {
    const last = vaultMessages[vaultMessages.length - 1]
    return last ? formatDateLabel(last.createdAt || new Date().toISOString()) : ''
  })

  const initialMsgIdsRef = useRef(null)
  if (initialMsgIdsRef.current === null) {
    initialMsgIdsRef.current = new Set(vaultMessages.map((m) => m.id))
  }

  const totalMsgCount = vaultMessages.length
  const sliceStart = Math.max(0, totalMsgCount - displayCount)
  const visibleMessages = vaultMessages.slice(sliceStart)
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
    if (needsLock) return
    if (vaultMessages.length === 0) return
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
  }, [vaultMessages.length, scrollChatToBottom, syncHeaderDate, needsLock])

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
    if (needsLock) return
    const isNewMessage = vaultMessages.length > prevMsgCountRef.current
    prevMsgCountRef.current = vaultMessages.length
    if (!loadingMoreRef.current && (isNewMessage || isThinking)) {
      scrollChatToBottom(isNewMessage)
    }
  }, [vaultMessages, isThinking, scrollChatToBottom, needsLock])

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
      addVaultChatMessage({
        role: 'ai',
        type: 'text',
        text: clean || '…',
        ...(hasCta ? { cta: { label: '지기(Keeper)로 이동', to: '/' } } : {}),
      })
    },
    [addVaultChatMessage],
  )

  const executeTool = useCallback(
    async (toolName, args) => {
      if (toolName === 'add_vault_document') {
        const date = args?.date && String(args.date).trim() ? String(args.date).trim() : todayYmd()
        const title = String(args?.title || '').trim() || '(제목 없음)'
        const target = String(args?.target || '').trim()
        const rawExp = args?.expiry_date
        const expiry_date =
          rawExp == null || rawExp === '' || String(rawExp).toLowerCase() === 'null'
            ? null
            : String(rawExp).trim()
        const category = String(args?.category || '기타 문서')
        const memo = String(args?.memo != null ? args.memo : '')
        const row = addSecretVaultDocument({ date, title, target, expiry_date, category, memo })
        return { success: true, id: row.id, stub: true }
      }
      if (toolName === 'open_vault_document') {
        const document_id = args?.document_id != null ? String(args.document_id).trim() : ''
        const title_hint = args?.title_hint != null ? String(args.title_hint).trim() : ''
        const summary_for_panel = String(args?.summary_for_panel || '').trim() || '요약 없음'
        const list = useVaultStore.getState().secretVaultDocuments
        let match =
          (document_id && list.find((d) => d.id === document_id)) ||
          (title_hint &&
            list.find(
              (d) =>
                d.title.includes(title_hint) || (d.memo && d.memo.includes(title_hint)),
            ))
        if (!match && list.length === 1) match = list[0]
        setVaultTheaterRequest({
          documentId: match?.id || document_id || null,
          title: match?.title || title_hint || '문서',
          summary: summary_for_panel,
        })
        return {
          success: true,
          opened: { documentId: match?.id || document_id || null, summary_for_panel },
        }
      }
      return { error: `알 수 없는 도구: ${toolName}` }
    },
    [addSecretVaultDocument, setVaultTheaterRequest],
  )

  const runVaultChat = useCallback(
    async (userText) => {
      conversationRef.current = vaultMessagesToApiMessages(useVaultStore.getState().vaultMessages)

      addVaultChatMessage({ role: 'user', type: 'text', text: userText })
      conversationRef.current.push({ role: 'user', content: userText })

      setIsThinking(true)
      setThinkingLabel('기록을 검토하는 중…')

      try {
        let safetyBreaker = 0
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (++safetyBreaker > 8) throw new Error('응답 루프가 너무 깁니다.')

          const res = await fetch(resolveApiUrl('/api/chat-assistant-vault'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: conversationRef.current,
              assistantType: 'vault',
              vaultContext: { documents: useVaultStore.getState().secretVaultDocuments },
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

              if (toolName === 'add_vault_document') setThinkingLabel('문서 메타를 반영하는 중…')
              if (toolName === 'open_vault_document') setThinkingLabel('열람 화면을 여는 중…')

              const toolResult = await executeTool(toolName, a)

              conversationRef.current.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolResult),
              })
            }

            setThinkingLabel('응답을 정리하는 중…')
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
        const msg = error instanceof Error ? error.message : '오류가 발생했습니다.'
        addVaultChatMessage({ role: 'ai', type: 'text', text: `… ${msg}` })
      } finally {
        setIsThinking(false)
        setThinkingLabel('…')
      }
    },
    [addVaultChatMessage, executeTool, pushAssistantReply],
  )

  const onSendHandlerRef = useRef(runVaultChat)
  onSendHandlerRef.current = runVaultChat
  const stableOnSend = useCallback((t) => onSendHandlerRef.current(t), [])

  const onUnlocked = useCallback(() => {
    setNeedsLock(false)
    setPinError('')
  }, [])

  if (needsLock) {
    return (
      <aside
        className={`${CHAT_PANEL_ASIDE_LAYOUT} mt-6 overflow-hidden rounded-t-3xl rounded-b-2xl border border-slate-800/80 bg-slate-950 shadow-[0_12px_48px_rgba(0,0,0,0.75)]`}
      >
        <VaultLockScreen
          onUnlocked={onUnlocked}
          onError={setPinError}
          onOpenSettings={() => useUIStore.getState().openSettingsModal()}
          errorMessage={pinError}
        />
      </aside>
    )
  }

  return (
    <aside
      className={`${CHAT_PANEL_ASIDE_LAYOUT} mt-6 bg-gradient-to-b from-slate-950 to-slate-900 backdrop-blur-xl rounded-t-3xl rounded-b-2xl shadow-[0_12px_48px_rgba(0,0,0,0.55)] border border-slate-800/80`}
    >
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/95">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-600/60 flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-amber-700/80 text-[18px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  inventory_2
                </span>
              </div>
            </div>
            <h2 className="text-[15px] font-bold text-slate-200 tracking-tight truncate">금고 집사</h2>
          </div>
          {headerDate && (
            <span className="text-[10px] text-slate-500 font-medium shrink-0 tabular-nums">{headerDate}</span>
          )}
        </div>
        {!isVaultPinConfigured() && (
          <p className="text-[10px] text-slate-500 mt-2">
            잠금을 켜려면{' '}
            <button
              type="button"
              className="text-amber-600/90 underline"
              onClick={() => useUIStore.getState().openSettingsModal()}
            >
              설정
            </button>
            에서 PIN을 등록하세요.
          </p>
        )}
      </div>

      <div
        ref={msgContainerRef}
        onScroll={handleMsgScroll}
        className="flex-grow overflow-y-auto px-3 py-2 space-y-2 text-sm chat-panel-scrollbar min-h-[220px] bg-slate-950/40"
      >
        {hasOlderMessages && (
          <div className="text-center py-1">
            <span className="text-[10px] text-slate-600">이전 대화</span>
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
                      ? 'bg-slate-800 text-slate-100 border border-slate-600/50 rounded-tr-sm'
                      : 'bg-slate-900/90 text-slate-200/95 border border-slate-700/60 rounded-tl-sm'
                  }`}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap leading-relaxed text-[13px]">{msg.text}</p>
                  ) : (
                    <MessageWithActionLinks text={msg.text} className="text-[13px] leading-relaxed" linkVariant="contrast" />
                  )}
                  {msg.cta && (
                    <Link
                      to={msg.cta.to}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-amber-500/90 px-3 py-1.5 rounded-lg border border-amber-400/50 hover:opacity-95"
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
            <div className="bg-slate-900 border border-slate-700 px-3 py-2 rounded-2xl rounded-tl-none">
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5">
                  <span
                    className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-amber-700/80 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
                <span className="text-slate-500 text-xs font-medium">{thinkingLabel}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <IsolatedChatComposer
        variant="vault"
        disabled={isThinking}
        thinkingLabel={thinkingLabel}
        idlePlaceholder="문서 등록·열람·보관이 필요하면 말씀하세요."
        onSend={stableOnSend}
      />
    </aside>
  )
}
