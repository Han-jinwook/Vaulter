/** YYYY-MM-DD (로컬 달력 기준 표시/저장) */

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false
  const t = new Date(`${s}T00:00:00`)
  return !isNaN(t.getTime())
}

export function todayYmdLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 툴 인자·임의 문자열 → YYYY-MM-DD, 실패 시 오늘(로컬) */
export function parseYmdOrToday(v: unknown): string {
  const s = String(v ?? '').trim()
  if (isValidYmd(s)) return s
  return todayYmdLocal()
}

/** UI: 2026-04-22 → '26.04.22 기준' */
export function formatYmdAsOfLabel(ymd: string | undefined): string {
  if (!ymd || !isValidYmd(ymd)) return ''
  const [y, m, d] = ymd.split('-')
  return `${y.slice(2)}.${m}.${d} 기준`
}

export function ymdToIsoStartUtc(ymd: string): string {
  if (!isValidYmd(ymd)) return new Date(0).toISOString()
  return `${ymd}T00:00:00.000Z`
}

/** ISO 또는 YYYY-MM-DD → YYYY-MM-DD (히스토리 이행용) */
export function coerceToYmd(s: string | undefined): string {
  if (!s) return todayYmdLocal()
  const t = String(s).trim()
  if (isValidYmd(t)) return t
  if (t.length >= 10) {
    const head = t.slice(0, 10)
    if (isValidYmd(head)) return head
  }
  return todayYmdLocal()
}
