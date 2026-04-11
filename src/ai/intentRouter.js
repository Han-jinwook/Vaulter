export const Tier1Intent = {
  ROUTE_LEDGER: 'ROUTE_LEDGER',
  ANALYZE_UNCLASSIFIED: 'ANALYZE_UNCLASSIFIED',
  GENERAL_CHAT: 'GENERAL_CHAT',
}

const tier1Rules = [
  { intent: Tier1Intent.ROUTE_LEDGER, pattern: /(내역|원장|거래|어제 얼마|쓴 돈|지출 보여)/i },
  { intent: Tier1Intent.ANALYZE_UNCLASSIFIED, pattern: /(미분류|분류 대기|정리할래|정리해줘|검토 필요 정리)/i },
]

const routeRules = [
  { intent: 'open_keeper', pattern: /(지기|메인|홈|대시보드)/i, path: '/' },
  { intent: 'open_ledger', pattern: /(내역|원장|거래)/i, path: '/' },
  { intent: 'open_assets', pattern: /(자산|포트폴리오|황금자산)/i, path: '/assets' },
  { intent: 'open_budget', pattern: /(예산|목표|플랜)/i, path: '/budget' },
  { intent: 'open_vault', pattern: /(비밀금고|증빙|계약서|보증서|문서)/i, path: '/vault' },
]

const parseRules = [
  /(축의금|더치페이|개인\s*송금|분류)/i,
  /(카카오페이|토스|송금).*(\d{1,3}(,\d{3})*|\d+)\s*원/i,
]

const adviceRules = [
  /(재조정|전략|어떻게|추천|상담|분석|시나리오)/i,
  /(식비|고정지출|저축).*(늘|줄|관리)/i,
]

/**
 * Tier 1 로컬 인텐트 라우터 (AIChatPanel 전용)
 * - ROUTE_LEDGER: 지기방 하단 원장 포커스
 * - ANALYZE_UNCLASSIFIED: PENDING 내역 검토 플로우 트리거
 * - GENERAL_CHAT: 일반 채팅, 기존 파이프라인으로 전달
 */
export function classifyTier1Intent(input = '') {
  const text = String(input).trim()
  if (!text) return { intent: Tier1Intent.GENERAL_CHAT, text }

  for (const rule of tier1Rules) {
    if (rule.pattern.test(text)) {
      return { intent: rule.intent, text }
    }
  }
  return { intent: Tier1Intent.GENERAL_CHAT, text }
}

/**
 * Tier1 intent executor
 * - handlers를 주입받아 UI 상태/스토어 변경을 라우터 레벨에서 실행한다.
 */
export function handleTier1Intent(input = '', handlers = {}) {
  const routed = classifyTier1Intent(input)

  switch (routed.intent) {
    case Tier1Intent.ROUTE_LEDGER: {
      console.log('[Intent] ROUTE_LEDGER 트리거됨')
      handlers.onRouteLedger?.()
      break
    }
    case Tier1Intent.ANALYZE_UNCLASSIFIED: {
      console.log('[Intent] ANALYZE_UNCLASSIFIED 트리거됨')
      handlers.onAnalyzeUnclassified?.()
      break
    }
    default: {
      console.log('[Intent] GENERAL_CHAT 트리거됨')
      handlers.onGeneralChat?.()
      break
    }
  }

  return routed
}

export function detectIntent(input = '') {
  const text = String(input).trim()
  if (!text) return { tier: 'tier1_local_router', intent: 'empty' }

  for (const rule of routeRules) {
    if (rule.pattern.test(text)) {
      return { tier: 'tier1_local_router', intent: rule.intent, route: rule.path }
    }
  }

  if (parseRules.some((r) => r.test(text))) {
    return { tier: 'tier2_low_cost', intent: 'parse_transaction' }
  }

  if (adviceRules.some((r) => r.test(text))) {
    return { tier: 'tier3_high_reasoning', intent: 'financial_advice' }
  }

  return { tier: 'tier2_low_cost', intent: 'general_parse' }
}

