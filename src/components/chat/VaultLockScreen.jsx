import { useState, useCallback } from 'react'
import { verifyVaultPinOnServer } from '../../lib/vaultPinClient'

/**
 * 비밀금고 Phase 2 — Matte Black & Metallic Blue 잠금 UI
 * (채팅 패널 aside 내부에서 풀 브리드)
 */
export default function VaultLockScreen({ onUnlocked, onError, onOpenSettings, errorMessage = '' }) {
  const [digits, setDigits] = useState([])
  const [busy, setBusy] = useState(false)
  const maxLen = 6

  const clearDigits = useCallback(() => {
    setDigits([])
    onError('')
  }, [onError])

  const submit = useCallback(async () => {
    if (busy) return
    const pin = digits.join('')
    if (pin.length < 4) {
      onError('PIN을 4~6자리로 입력하세요.')
      return
    }
    setBusy(true)
    onError('')
    const r = await verifyVaultPinOnServer(pin)
    setBusy(false)
    if (r.ok) {
      setDigits([])
      onError('')
      onUnlocked()
    } else {
      setDigits([])
      onError(r.error || 'PIN이 맞지 않습니다.')
    }
  }, [busy, digits, onError, onUnlocked])

  const append = (d) => {
    if (busy) return
    setDigits((prev) => (prev.length >= maxLen ? prev : [...prev, d]))
  }

  const back = () => setDigits((d) => d.slice(0, -1))

  const openForgot = () => {
    if (typeof onOpenSettings === 'function') onOpenSettings()
  }

  return (
    <div className="relative min-h-[420px] flex flex-col overflow-hidden rounded-b-2xl">
      {/* 금고 문 느낌 배경 + 딥 블루 누출 */}
      <div
        className="pointer-events-none absolute inset-0 bg-slate-950"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_40%,rgba(30,64,175,0.12)_0%,transparent_50%),radial-gradient(ellipse_60%_50%_at_80%_20%,rgba(59,130,246,0.14)_0%,transparent_45%),repeating-linear-gradient(0deg,transparent,transparent_3px,rgba(15,23,42,0.35)_3px,rgba(15,23,42,0.35)_4px),repeating-linear-gradient(90deg,transparent,transparent_2px,rgba(30,41,59,0.2)_2px,rgba(30,41,59,0.2)_3px)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-1/4 top-0 h-[75%] w-[75%] rounded-full bg-blue-500/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 backdrop-blur-[2px] bg-slate-950/55"
        aria-hidden
      />

      <div className="relative z-10 flex flex-1 flex-col items-center px-4 pb-3 pt-6 text-center">
        {/* Header */}
        <div className="mb-1 flex h-10 w-10 items-center justify-center">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-600/80 bg-gradient-to-b from-slate-700/90 to-slate-900 shadow-[0_0_20px_rgba(59,130,246,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]">
            <span
              className="material-symbols-outlined text-[20px] text-slate-200"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              lock
            </span>
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-400 shadow-[0_0_6px_#60a5fa]" />
          </div>
        </div>
        <h2 className="text-[15px] font-bold tracking-tight text-slate-100 [text-shadow:0_0_20px_rgba(250,204,21,0.12)]">
          🔐 비밀금고 (Vault)
        </h2>
        <p className="mt-1.5 max-w-[260px] text-xs leading-relaxed text-slate-400">
          접근하려면 PIN 번호를 입력하세요.
        </p>

        {/* PIN slots */}
        <div className="mb-5 mt-6 flex min-h-[36px] items-center justify-center gap-3 sm:gap-3.5">
          {Array.from({ length: maxLen }).map((_, i) => {
            const filled = i < digits.length
            return (
              <div
                key={i}
                className={`h-3.5 w-3.5 rounded-full border-2 transition-all duration-200 sm:h-4 sm:w-4 ${
                  filled
                    ? 'border-blue-300/50 bg-gradient-to-br from-sky-400 via-blue-600 to-blue-900 shadow-[0_0_10px_rgba(59,130,246,0.85),inset_0_1px_0_rgba(255,255,255,0.35)]'
                    : 'border-slate-500/80 bg-slate-950/40 shadow-inner ring-1 ring-slate-700/40'
                }`}
              />
            )
          })}
        </div>

        {/* Metallic numpad */}
        <div className="mb-2 grid w-[min(100%,220px)] grid-cols-3 gap-3.5 sm:w-[220px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy}
              onClick={() => append(n)}
              className="flex h-14 w-14 select-none items-center justify-center justify-self-center rounded-full border border-slate-600 bg-gradient-to-b from-slate-700 to-slate-900 text-lg font-semibold text-slate-100 shadow-[inset_0_2px_0_rgba(255,255,255,0.1),0_4px_12px_rgba(0,0,0,0.5)] transition-all hover:from-slate-600 hover:to-slate-800 active:scale-95 active:from-slate-800 active:to-slate-950 disabled:opacity-40"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={back}
            className="flex h-14 w-14 select-none items-center justify-center justify-self-center rounded-full border border-slate-600/90 bg-gradient-to-b from-slate-800 to-slate-950 text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:text-slate-200 active:scale-95"
            aria-label="한 칸 지우기"
          >
            <span className="material-symbols-outlined text-[22px]">backspace</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => append('0')}
            className="flex h-14 w-14 select-none items-center justify-center justify-self-center rounded-full border border-slate-600 bg-gradient-to-b from-slate-700 to-slate-900 text-lg font-semibold text-slate-100 shadow-[inset_0_2px_0_rgba(255,255,255,0.1),0_4px_12px_rgba(0,0,0,0.5)] transition-all hover:from-slate-600 hover:to-slate-800 active:scale-95 active:from-slate-800 disabled:opacity-40"
          >
            0
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={clearDigits}
            className="flex h-14 w-14 select-none items-center justify-center justify-self-center rounded-full border border-slate-600/90 bg-gradient-to-b from-slate-800 to-slate-950 text-xs font-bold text-slate-500 transition-all hover:text-slate-300 active:scale-95"
            aria-label="전체 지우기"
          >
            C
          </button>
        </div>

        {errorMessage ? (
          <p className="mb-1 max-w-xs text-center text-xs text-amber-500/90">{errorMessage}</p>
        ) : null}

        <button
          type="button"
          disabled={busy || digits.length < 4}
          onClick={() => void submit()}
          className="mb-1 mt-1 min-w-[160px] rounded-full border border-blue-500/40 bg-gradient-to-b from-slate-800/90 to-slate-950 px-6 py-2 text-sm font-bold text-slate-200 shadow-[0_0_20px_rgba(59,130,246,0.25),inset_0_1px_0_rgba(255,255,255,0.08)] transition-all hover:border-blue-400/50 hover:shadow-[0_0_24px_rgba(59,130,246,0.35)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? '확인 중…' : '잠금 해제'}
        </button>

        {/* Footer */}
        <div className="mt-auto flex w-full max-w-xs items-center justify-between pt-1 text-[10px] text-slate-600">
          <button
            type="button"
            onClick={clearDigits}
            className="px-1 py-1 transition-colors hover:text-slate-400"
          >
            취소
          </button>
          <div className="h-2.5 w-px bg-slate-700/80" />
          <button
            type="button"
            onClick={openForgot}
            className="px-1 py-1 transition-colors hover:text-slate-500"
          >
            비밀번호를 잊으셨나요?
          </button>
        </div>
      </div>
    </div>
  )
}
