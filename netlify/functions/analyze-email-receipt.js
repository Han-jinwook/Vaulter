const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  }
}

function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = String(text || '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function countKeywordHits(text, keywords) {
  const safe = String(text || '').toLowerCase()
  return keywords.reduce((count, keyword) => count + (safe.includes(keyword.toLowerCase()) ? 1 : 0), 0)
}

function parseAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(value)
  const digits = String(value || '')
    .replace(/[^\d.-]/g, '')
    .trim()
  const n = Number(digits)
  if (!Number.isFinite(n)) return 0
  return Math.abs(n)
}

function detectCurrency(dataAmountRaw, sourceText) {
  const amountText = String(dataAmountRaw || '').toUpperCase()
  const source = String(sourceText || '').toUpperCase()
  if (
    amountText.includes('$') ||
    amountText.includes('USD') ||
    source.includes('US$') ||
    source.includes('USD')
  ) {
    return 'USD'
  }
  return 'KRW'
}

function toKrwAmount(amount, currency) {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (currency === 'USD') {
    const usdToKrw = 1350
    return Math.round(amount * usdToKrw)
  }
  return Math.round(amount)
}

function cleanMerchantCandidate(value) {
  const base = String(value || '').replace(/\s+/g, ' ').trim()
  if (!base) return ''
  const lower = base.toLowerCase()
  if (lower === 'unknown' || lower === 'merchant unknown' || lower === '가맹점 미확인') return ''
  return base
}

function parseFromField(from) {
  const raw = String(from || '').trim()
  const angle = raw.match(/^(.*?)<([^>]+)>/)
  const email = String(angle?.[2] || raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '').trim()
  const displayName = cleanMerchantCandidate(String(angle?.[1] || raw.replace(email, '')).replace(/["<>]/g, '').trim())
  const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : ''
  return { displayName, email, domain }
}

function merchantFromDomain(domain) {
  const safe = String(domain || '').toLowerCase()
  if (!safe) return ''
  if (safe.includes('google')) return 'Google Cloud'
  if (safe.includes('apple')) return 'Apple'
  if (safe.includes('naver')) return '네이버'
  if (safe.includes('coupang')) return '쿠팡'
  if (safe.includes('netflix')) return 'Netflix'
  if (safe.includes('openai')) return 'ChatGPT Plus'
  if (safe.includes('anthropic')) return 'Claude'
  if (safe.includes('exafunction')) return 'Windsurf'
  return cleanMerchantCandidate(safe.split('.').slice(0, 2).join(' '))
}

function normalizeMerchant(rawMerchant, metadata) {
  const base = cleanMerchantCandidate(rawMerchant)
  const sourceText = [metadata?.subject, metadata?.from, metadata?.snippet, metadata?.body]
    .filter(Boolean)
    .join('\n')
  const text = String(sourceText || '').toLowerCase()
  const { displayName, domain } = parseFromField(metadata?.from)
  const receiptMerchant = extractMerchantFromReceiptLines(sourceText)

  if (receiptMerchant) return receiptMerchant
  if (base) {
    if (/^exafunction\b/i.test(base)) return 'Windsurf'
    if (/^openai\b/i.test(base)) return 'ChatGPT Plus'
    return base
  }
  if (displayName) return displayName
  if (text.includes('chatgpt plus')) return 'ChatGPT Plus'
  if (text.includes('google ai pro')) return 'Google AI Pro'
  if (text.includes('google cloud')) return 'Google Cloud'
  if (text.includes('windsurf')) return 'Windsurf'
  if (text.includes('netflix')) return 'Netflix'
  if (text.includes('anthropic') || text.includes('claude')) return 'Claude'
  return merchantFromDomain(domain) || '이메일 결제'
}

function normalizeCategory(rawCategory, sourceText) {
  const raw = String(rawCategory || '').trim()
  const key = raw.toLowerCase()
  const text = String(sourceText || '').toLowerCase()
  const dict = {
    subscription: '구독',
    subscriptions: '구독',
    media: '미디어',
    entertainment: '미디어',
    cloud: '클라우드',
    'cloud services': '클라우드',
    service: '서비스',
    services: '서비스',
    shopping: '쇼핑',
    food: '식비',
    transport: '교통',
    utility: '공과금',
    utilities: '공과금',
    tax: '세금',
    income: '수입',
    refund: '환급',
    transfer: '이체',
    others: '기타',
    other: '기타',
  }
  if (dict[key]) return dict[key]
  if (text.includes('netflix') || text.includes('youtube')) return '미디어'
  if (
    text.includes('openai') ||
    text.includes('google cloud') ||
    text.includes('windsurf') ||
    text.includes('exafunction') ||
    text.includes('claude')
  ) {
    return '클라우드'
  }
  if (text.includes('coupang') || text.includes('11st') || text.includes('gmarket')) return '쇼핑'
  return raw || '기타'
}

function extractMerchantFromReceiptLines(sourceText) {
  const lines = String(sourceText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const productMatchers = [
    { pattern: /\bWindsurf(?:\s+Pro)?\b/i, merchant: 'Windsurf' },
    { pattern: /\bChatGPT(?:\s+Plus)?\b/i, merchant: 'ChatGPT Plus' },
    { pattern: /\bClaude(?:\s+Pro)?\b/i, merchant: 'Claude' },
    { pattern: /\bGoogle AI Pro\b/i, merchant: 'Google AI Pro' },
    { pattern: /\bNetflix\b/i, merchant: 'Netflix' },
    { pattern: /\bYouTube(?:\s+Premium)?\b/i, merchant: 'YouTube' },
  ]

  for (const line of lines) {
    for (const matcher of productMatchers) {
      if (matcher.pattern.test(line)) {
        return matcher.merchant
      }
    }
  }

  return ''
}

function normalizeModelData(data, metadata) {
  const fallbackSource = [metadata?.subject, metadata?.from, metadata?.snippet, metadata?.body]
    .filter(Boolean)
    .join('\n')
  const currency = detectCurrency(data?.amount, fallbackSource)
  const parsedAmount = parseAmount(data?.amount)
  const amount = toKrwAmount(parsedAmount, currency)
  const merchant = normalizeMerchant(data?.merchant, metadata)
  const dateRaw = String(data?.date || '').trim()
  const dateMatch = dateRaw.match(/(\d{4})[-./](\d{2})[-./](\d{2})/)
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null
  const confidence = Math.max(0, Math.min(1, Number(data?.confidence ?? 0.75)))
  const category = normalizeCategory(data?.category, `${fallbackSource}\n${merchant}`)
  const reasoningRaw = String(data?.reasoning || '').trim()
  const hasHangul = /[가-힣]/.test(reasoningRaw)
  return {
    merchant,
    date,
    amount,
    currency,
    originalAmount: parsedAmount,
    category,
    reasoning: hasHangul
      ? reasoningRaw
      : currency === 'USD'
        ? `${merchant} ${category} 결제(USD ${parsedAmount})를 원화 추정 환산하여 분류`
        : `${merchant} ${category} 결제 메일 기준 자동 분류`,
    confidence,
  }
}

function pickKnownMerchant(metadata) {
  const subject = String(metadata?.subject || '')
  const from = String(metadata?.from || '')
  const snippet = String(metadata?.snippet || '')
  const body = String(metadata?.body || '')
  const sourceText = [subject, from, snippet, body].join('\n')
  const text = sourceText.toLowerCase()
  const receiptMerchant = extractMerchantFromReceiptLines(sourceText)
  const { displayName, domain } = parseFromField(from)
  if (receiptMerchant) return receiptMerchant
  if (displayName) return displayName
  if (text.includes('chatgpt plus')) return 'ChatGPT Plus'
  if (text.includes('openai')) return 'ChatGPT Plus'
  if (text.includes('google ai pro')) return 'Google AI Pro'
  if (text.includes('google cloud')) return 'Google Cloud'
  if (text.includes('google one')) return 'Google One'
  if (text.includes('windsurf pro') || text.includes('windsurf') || text.includes('exafunction')) return 'Windsurf'
  if (text.includes('anthropic') || text.includes('claude')) return 'Claude'
  if (text.includes('netflix')) return 'Netflix'
  if (text.includes('youtube')) return 'YouTube'
  if (text.includes('coupang')) return '쿠팡'
  if (text.includes('woowahan') || text.includes('배달의민족')) return '배달의민족'
  if (text.includes('naver')) return '네이버'
  return merchantFromDomain(domain)
}

function extractDateFromText(sourceText) {
  const text = String(sourceText || '')
  const m = text.match(/(20\d{2})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

function extractAmountFromText(sourceText) {
  const text = String(sourceText || '')
  const krwMatches = Array.from(text.matchAll(/(?:₩|KRW\s*|원\s*)([\d,]+(?:\.\d+)?)/gi))
    .map((m) => Math.round(Number(String(m[1] || '').replace(/,/g, ''))))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (krwMatches.length) {
    return { amount: Math.max(...krwMatches), currency: 'KRW' }
  }

  const usdMatches = Array.from(text.matchAll(/(?:US\$|\$|USD\s*)([\d,]+(?:\.\d+)?)/gi))
    .map((m) => Number(String(m[1] || '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (usdMatches.length) {
    return { amount: Math.max(...usdMatches), currency: 'USD' }
  }

  const genericMatches = Array.from(text.matchAll(/([\d,]{3,})(?:원)?/g))
    .map((m) => Math.round(Number(String(m[1] || '').replace(/,/g, ''))))
    .filter((n) => Number.isFinite(n) && n >= 100)
  if (genericMatches.length) {
    return { amount: Math.max(...genericMatches), currency: 'KRW' }
  }

  return { amount: 0, currency: 'KRW' }
}

function isLikelyPromotionalEmail(metadata) {
  const subject = String(metadata?.subject || '')
  const from = String(metadata?.from || '')
  const snippet = String(metadata?.snippet || '')
  const body = String(metadata?.body || '')
  const text = [subject, from, snippet, body].join('\n')

  const promoSignals = [
    '특가',
    'special offers',
    '할인',
    '혜택',
    '구매하기',
    '지금 구매',
    '첫해 한정',
    '종료',
    '수신 거부',
    '개인정보 처리방침',
    '마케팅 이메일',
    '이 메시지에 회신하지 마십시오',
    '온라인으로 보기',
    'facebook',
    'instagram',
    'youtube',
    'photoshop',
    'illustrator',
    'premiere',
    'lightroom',
    'creative cloud',
  ]
  const transactionSignals = [
    '영수증 번호',
    '청구서 번호',
    '결제 방식',
    '결제 완료',
    '결제됨',
    'paid',
    'payment method',
    'invoice #',
    'receipt #',
    '영수증',
    '청구서',
    '총액',
    '주문번호',
    '승인번호',
  ]

  const promoScore = countKeywordHits(text, promoSignals)
  const transactionScore = countKeywordHits(text, transactionSignals)
  const hasReceiptNumber = /영수증\s*번호|receipt\s*#/i.test(text)
  const hasInvoiceNumber = /청구서\s*번호|invoice\s*#/i.test(text)
  const hasPaymentMethod = /결제\s*방식|payment method/i.test(text)
  const hasMaskedCard = /\*{2,}|\b-\d{4}\b/.test(text)

  if (hasReceiptNumber || hasInvoiceNumber || hasPaymentMethod || hasMaskedCard) {
    return false
  }

  return promoScore >= 4 && promoScore >= transactionScore + 2
}

function heuristicParseEmail(metadata) {
  const sourceText = [metadata?.subject, metadata?.from, metadata?.date, metadata?.snippet, metadata?.body]
    .filter(Boolean)
    .join('\n')
  const merchant = pickKnownMerchant(metadata) || normalizeMerchant('', metadata)
  const { amount: originalAmount, currency } = extractAmountFromText(sourceText)
  const amount = toKrwAmount(originalAmount, currency)
  const date = extractDateFromText(sourceText)
  const category = normalizeCategory('', `${sourceText}\n${merchant}`)

  return {
    merchant,
    date,
    amount,
    currency,
    originalAmount,
    category,
    reasoning:
      amount > 0
        ? `${merchant} 결제 메일 형식과 금액 패턴을 기준으로 자동 분류`
        : `${merchant} 결제 메일로 추정되지만 금액 확인이 필요합니다`,
    confidence: amount > 0 ? 0.56 : 0.34,
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  let requestBody
  try {
    requestBody = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const subject = String(requestBody.subject || '')
  const from = String(requestBody.from || '')
  const date = String(requestBody.date || '')
  const snippet = String(requestBody.snippet || '')
  const body = String(requestBody.body || '')

  const metadata = { subject, from, date, snippet, body }
  const sourceText = [subject, from, date, snippet, body].join('\n').trim()
  if (!sourceText) {
    return json(400, { error: 'Email text payload is empty' })
  }
  if (isLikelyPromotionalEmail(metadata)) {
    return json(200, {
      ok: true,
      skipped: true,
      skipReason: 'promotional_email',
      merchantHint: normalizeMerchant('', metadata),
    })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return json(200, {
      ok: true,
      data: heuristicParseEmail(metadata),
      fallback: 'heuristic',
    })
  }

  const systemPrompt = [
    '너는 대한민국 최고의 재무/회계 분류 전문가다.',
    'Gmail 결제/영수증 메일에서 결제 데이터를 구조화한다.',
    '광고/푸터/개인식별성이 불필요한 정보는 무시하고 merchant/date/amount/category/reasoning/confidence를 추출한다.',
    'amount는 반드시 숫자만 반환한다. 통화기호, 쉼표, KRW 문자열을 포함하지 않는다.',
    '통화가 달러(USD/US$/$)인 경우 반드시 명시하고, amount는 숫자만 반환한다.',
    'category는 한국어 한 단어로 반환한다. (예: 식비, 쇼핑, 구독, 서비스, 미디어, 교통, 공과금, 세금, 수입, 환급, 이체, 기타)',
    'reasoning은 한국어 1문장으로 간결하게 작성한다. 이 문장은 원장 적요에 표시된다.',
    'merchant는 법인명보다 사용자가 체감하는 서비스명/상품명을 우선한다. 예: OpenAI OpCo, LLC 대신 ChatGPT Plus',
    'merchant에 "가맹점 미확인", "Unknown", 빈 문자열을 절대 넣지 마라.',
    '본문에서 명확한 서비스명을 찾지 못하면 from 표시명(display name)을 merchant로 사용하라.',
    'from 표시명도 애매하면 from 이메일 도메인에서 가장 자연스러운 서비스/브랜드명을 추론해 merchant로 사용하라.',
    '영수증/청구서 본문에 상품명이나 플랜명(예: Windsurf Pro, ChatGPT Plus, Claude Pro)이 있으면 발급 법인명보다 그 서비스명을 merchant로 우선 채택한다.',
    'merchant를 비워 두지 말고, 발급사와 상품명 중 사용자에게 더 익숙한 이름 하나를 반드시 선택한다.',
    '부가세 표기 문구는 세금 카테고리 근거로 사용하지 않는다.',
    '광고/프로모션/혜택 안내 메일이면 결제 내역으로 추출하지 말고 {"skip":true,"reason":"promotional_email"} 형태로만 응답한다.',
    '반드시 JSON 형식으로만 응답한다.',
    '{"merchant":"","date":"YYYY-MM-DD","amount":0,"currency":"KRW|USD","category":"","reasoning":"","confidence":0.0}',
  ].join('\n')

  const openaiPayload = {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          '아래 이메일 결제 내역을 분석해 JSON으로만 답변해 주세요.',
          `subject: ${subject}`,
          `from: ${from}`,
          `date: ${date}`,
          `snippet: ${snippet}`,
          `body:\n${body}`,
        ].join('\n'),
      },
    ],
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openaiPayload),
    })

    const raw = await response.text()
    if (!response.ok) {
      return json(response.status, { error: 'OpenAI request failed', detail: raw })
    }

    const parsed = safeParseJSON(raw)
    const content =
      parsed?.choices?.[0]?.message?.content ||
      parsed?.output_text ||
      ''
    const data = safeParseJSON(content)

    if (!data) {
      return json(502, { error: 'Failed to parse model JSON response', detail: content })
    }

    if (data?.skip === true || data?.reason === 'promotional_email') {
      return json(200, { ok: true, skipped: true, skipReason: 'promotional_email' })
    }

    const normalized = normalizeModelData(data, metadata)
    return json(200, { ok: true, data: normalized })
  } catch (error) {
    return json(500, {
      error: 'analyze-email-receipt exception',
      detail: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
