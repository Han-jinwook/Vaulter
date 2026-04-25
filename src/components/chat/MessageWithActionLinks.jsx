import { Fragment } from 'react'
import { Link } from 'react-router-dom'

const RE = /\[ACTION_LINK:([^|]+)\|([^\]]+)\]/g

const linkClass = {
  default:
    'inline-flex items-center gap-1 my-0.5 mx-0.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary/15 text-primary border border-primary/30 hover:bg-primary hover:text-white transition-colors',
  contrast:
    'inline-flex items-center gap-1 my-0.5 mx-0.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-100 bg-slate-700/80 border border-slate-500/50 hover:bg-slate-600 transition-colors',
  ember:
    'inline-flex items-center gap-1 my-0.5 mx-0.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-100 bg-amber-900/50 border border-amber-500/40 hover:bg-amber-500/20 transition-colors',
}

/**
 * 4개 비서 공통: [ACTION_LINK:path|라벨] → 이동 링크
 */
export function MessageWithActionLinks({ text, className = '', linkVariant = 'default', linkClassName }) {
  if (typeof text !== 'string' || !text) return null
  const lc = linkClassName || linkClass[linkVariant] || linkClass.default
  const parts = []
  let last = 0
  const s = text
  let m
  const re = new RegExp(RE.source, 'g')
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ type: 't', v: s.slice(last, m.index) })
    parts.push({ type: 'a', to: m[1].trim(), label: m[2].trim() })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ type: 't', v: s.slice(last) })
  if (parts.length === 0) {
    return <p className={`whitespace-pre-wrap ${className}`}>{text}</p>
  }
  return (
    <p className={`whitespace-pre-wrap ${className}`}>
      {parts.map((p, i) =>
        p.type === 't' ? (
          <Fragment key={i}>{p.v}</Fragment>
        ) : (
          <Link key={i} to={p.to} className={lc}>
            {p.label}
          </Link>
        ),
      )}
    </p>
  )
}
