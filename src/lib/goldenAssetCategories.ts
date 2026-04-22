import type { AssetLineType } from '../types/assetLine'

/** type=ASSET — 고정 4 */
export const ASSET_CATEGORIES = [
  '투자 자산',
  '부동산/보증금',
  '보험/연금',
  '기타 자산',
] as const

/** type=DEBT — 고정 3 */
export const DEBT_CATEGORIES = ['대출', '개인 간 채무', '기타 부채'] as const

const ASSET_SET = new Set<string>(ASSET_CATEGORIES)
const DEBT_SET = new Set<string>(DEBT_CATEGORIES)

/** 상단 도넛: 자산 카테고리별 (현금/유동성은 별도) */
export const ASSET_CATEGORY_CHART_COLOR: Record<(typeof ASSET_CATEGORIES)[number], string> = {
  '투자 자산': '#3B82F6',
  '부동산/보증금': '#10B981',
  '보험/연금': '#A855F7',
  '기타 자산': '#94A3B8',
}

export const LIQUIDITY_CHART_COLOR = '#FFD700'

const LEGACY_ASSET_MAP: [RegExp, (typeof ASSET_CATEGORIES)[number]][] = [
  [/투자\s*자산/, '투자 자산'],
  [/^투자$|주식|ETF|펀드|코스피|코스닥|해외주식|배당/i, '투자 자산'],
  [/부동산\/?(실물|자산|투자)?|전세|월세|아파트|빌라|오피스텔|임대|real\s*estate/i, '부동산/보증금'],
  [/보증금/, '부동산/보증금'],
  [/보험|연금|IRP|ISA|퇴직|연말/i, '보험/연금'],
  [/기타(\s*자산)?$|^기타$/i, '기타 자산'],
  [/투자/i, '투자 자산'],
]

const LEGACY_DEBT_MAP: [RegExp, (typeof DEBT_CATEGORIES)[number]][] = [
  [/^대출$|전세?대출|주담대|신용대출|카드론|담보|모기지|마이너스|주택담보|학자금대출/i, '대출'],
  [/개인(\s*간)?\s*채무?|빌린|차용|가족|지인|친구|동료/i, '개인 간 채무'],
  [/기타(\s*부채)?$|^기타$/i, '기타 부채'],
]

/**
 * 기존 임의 라벨 → 확정 enum. (스토어 로드·툴 호출 직후 모두 사용)
 */
export function normalizeCategoryForType(type: AssetLineType, raw: string | undefined): string {
  const s0 = String(raw || '').trim()
  if (type === 'ASSET') {
    if (ASSET_SET.has(s0)) return s0
    for (const s of ASSET_CATEGORIES) {
      if (s0 === s.replace(/\s/g, '')) return s
    }
    for (const [re, to] of LEGACY_ASSET_MAP) {
      if (re.test(s0)) return to
    }
    if (!s0) return '기타 자산'
    return '기타 자산'
  }
  if (DEBT_SET.has(s0)) return s0
  for (const s of DEBT_CATEGORIES) {
    if (s0 === s.replace(/\s/g, '')) return s
  }
  for (const [re, to] of LEGACY_DEBT_MAP) {
    if (re.test(s0)) return to
  }
  if (!s0) return '기타 부채'
  return '기타 부채'
}

/** UI 아코디언: 고정 순, 데이터 있는 카테고리만 */
export function groupLinesByCategoryOrdered<T extends { category: string; id: string }>(
  lines: T[],
  type: AssetLineType,
  ordered: readonly string[],
): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const row of lines) {
    const c = normalizeCategoryForType(type, row.category)
    if (!m.has(c)) m.set(c, [])
    m.get(c)!.push({ ...row, category: c } as T)
  }
  const out: [string, T[]][] = []
  for (const cat of ordered) {
    const list = m.get(cat)
    if (list && list.length > 0) out.push([cat, list])
  }
  return out
}
