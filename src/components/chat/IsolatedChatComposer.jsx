import { useRef, useCallback, useLayoutEffect, memo } from 'react'

const variants = {
  budget: {
    wrap: 'p-3 pt-2 border-t border-slate-600/20 bg-[#0a0c12]/92 [contain:layout] isolate',
    inner:
      'flex items-center bg-[#0c1018] rounded-2xl px-3 py-1 border border-slate-600/30 shadow-[inset_0_1px_0_rgba(148,163,184,0.06)] focus-within:border-sky-500/45',
    icon: 'pie_chart',
    iconClass: "material-symbols-outlined text-sky-400/80 text-[16px] mr-2 shrink-0",
    input:
      'w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 text-slate-100/95 disabled:opacity-50',
    btn: 'w-8 h-8 bg-gradient-to-br from-slate-500 to-sky-600 text-slate-50 rounded-xl flex items-center justify-center shadow-lg shadow-slate-900/50 hover:scale-105 transition-transform active:scale-95 shrink-0 border border-sky-400/25',
  },
  coach: {
    wrap: 'p-3 pt-2 border-t border-emerald-500/12 bg-[#0a1010]/90 [contain:layout] isolate',
    inner:
      'flex items-center bg-[#0a0f0e] rounded-2xl px-3 py-1 border border-emerald-500/25 shadow-[inset_0_1px_0_rgba(16,185,129,0.08)] focus-within:border-emerald-400/50',
    icon: 'fitness_center',
    iconClass: "material-symbols-outlined text-emerald-400/85 text-[16px] mr-2 shrink-0",
    input:
      'w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 text-emerald-50/95 disabled:opacity-50',
    btn: 'w-8 h-8 bg-gradient-to-br from-emerald-500 to-teal-700 text-[#061210] rounded-xl flex items-center justify-center shadow-lg shadow-emerald-900/40 hover:scale-105 transition-transform active:scale-95 shrink-0 border border-emerald-400/30',
  },
  asset: {
    wrap: 'p-3 pt-2 border-t border-[#FFD700]/10 bg-[#101010]/90 [contain:layout] isolate',
    inner:
      'flex items-center bg-[#0a0a0a] rounded-2xl px-3 py-1 border border-[#FFD700]/25 shadow-[inset_0_1px_0_rgba(255,215,0,0.06)] focus-within:border-[#FFD700]/50',
    icon: 'savings',
    iconClass: "material-symbols-outlined text-[#B8860B]/70 text-[16px] mr-2 shrink-0",
    input:
      'w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 text-[#f0e6d2]/95 disabled:opacity-50',
    btn: 'w-8 h-8 bg-gradient-to-br from-[#FFD700] to-[#8B6914] text-[#120f08] rounded-xl flex items-center justify-center shadow-lg shadow-black/40 hover:scale-105 transition-transform active:scale-95 shrink-0 border border-[#FFD700]/30',
  },
  keeper: {
    wrap: 'p-3 pt-2 [contain:layout] isolate',
    inner:
      'flex items-center bg-[#0f172a] rounded-2xl px-3 py-1 border border-[#FFD700]/30 shadow-[0_0_12px_rgba(255,215,0,0.08)] focus-within:border-[#FFD700]/60 focus-within:shadow-[0_0_20px_rgba(255,215,0,0.18)]',
    icon: 'lock',
    iconClass: "material-symbols-outlined text-[#FFD700]/50 text-[16px] mr-2 shrink-0",
    input:
      'w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 text-white/90 disabled:opacity-50',
    btn: 'w-8 h-8 bg-gradient-to-br from-[#FFD700] to-[#F59E0B] text-[#1a1109] rounded-xl flex items-center justify-center shadow-lg shadow-[#FFD700]/30 hover:scale-105 transition-transform active:scale-95 shrink-0',
  },
  vault: {
    wrap: 'p-3 pt-2 border-t border-slate-700/30 bg-slate-950/95 [contain:layout] isolate',
    inner:
      'flex items-center bg-slate-900 rounded-2xl px-3 py-1 border border-slate-700/50 shadow-[inset_0_1px_0_rgba(51,65,85,0.2)] focus-within:border-amber-700/50',
    icon: 'shield_lock',
    iconClass: "material-symbols-outlined text-slate-500 text-[16px] mr-2 shrink-0",
    input:
      'w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm py-2 text-slate-200/95 disabled:opacity-50',
    btn: 'w-8 h-8 bg-gradient-to-br from-slate-600 to-slate-900 text-amber-100/90 rounded-xl flex items-center justify-center shadow-lg shadow-black/60 hover:scale-105 transition-transform active:scale-95 shrink-0 border border-slate-600/80',
  },
}

const inputPlaceholder = {
  budget: 'placeholder:text-slate-500/60',
  coach: 'placeholder:text-emerald-200/35',
  asset: 'placeholder:text-[#6b5f48]',
  keeper: 'placeholder:text-white/50',
  vault: 'placeholder:text-slate-500/50',
}

/**
 * 비제어 input. placeholder/disabled 는 조합(IME) 중엔 DOM을 갱신하지 않음.
 * onSend 는 부모에서 useRef+useCallback 으로 참조를 고정해 주면(지기/자산 패널에서 처리) memo가 효과가 있다.
 */
function IsolatedChatComposer({ variant, disabled, thinkingLabel, idlePlaceholder, onSend }) {
  const vKey =
    variant === 'asset'
      ? 'asset'
      : variant === 'budget'
        ? 'budget'
        : variant === 'coach'
          ? 'coach'
          : variant === 'vault'
            ? 'vault'
            : 'keeper'
  const v = variants[vKey] || variants.keeper

  const inputRef = useRef(null)
  const inComposeRef = useRef(false)

  const metaRef = useRef({ disabled: false, thinkingLabel: '', idlePlaceholder: '' })
  metaRef.current = { disabled, thinkingLabel, idlePlaceholder }

  const applyDomMeta = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    if (inComposeRef.current) return
    const { disabled: d, thinkingLabel: tl, idlePlaceholder: ip } = metaRef.current
    const ph = d && tl ? tl : ip
    if (el.placeholder !== ph) el.placeholder = ph
    const dis = !!d
    if (el.disabled !== dis) el.disabled = dis
  }, [])

  const onCompositionStart = useCallback(() => {
    inComposeRef.current = true
  }, [])

  const onCompositionEnd = useCallback(() => {
    inComposeRef.current = false
    const el = inputRef.current
    if (!el) return
    const { disabled: d, thinkingLabel: tl, idlePlaceholder: ip } = metaRef.current
    const ph = d && tl ? tl : ip
    el.placeholder = ph
    el.disabled = !!d
  }, [])

  useLayoutEffect(() => {
    applyDomMeta()
  }, [disabled, thinkingLabel, idlePlaceholder, applyDomMeta])

  const submit = useCallback(() => {
    const el = inputRef.current
    if (!el || el.disabled) return
    const t = el.value.trim()
    if (!t) return
    onSend(t)
    el.value = ''
  }, [onSend])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  return (
    <div className={v.wrap}>
      <div className={v.inner}>
        <span
          className={v.iconClass}
          style={{ fontVariationSettings: "'FILL' 1" }}
          aria-hidden
        >
          {v.icon}
        </span>
        <input
          ref={inputRef}
          type="text"
          name="chat-composer"
          defaultValue=""
          onKeyDown={handleKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          spellCheck={false}
          autoComplete="off"
          className={`${v.input} ${inputPlaceholder[vKey]}`}
        />
        <button
          type="button"
          onClick={submit}
          className={v.btn}
          disabled={disabled}
          aria-label="보내기"
        >
          <span className="material-symbols-outlined text-[17px]">send</span>
        </button>
      </div>
    </div>
  )
}

export default memo(IsolatedChatComposer)
