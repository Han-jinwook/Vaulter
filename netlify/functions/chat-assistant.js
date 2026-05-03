import fs from 'node:fs'
import path from 'node:path'
import { interRoomSystemSuffixForKeeper } from './interRoomSystemSuffix.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

function randomIdPart() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** `add_ledger_entry` 전용 — 지출/수입 각각 이 명칭만 허용(임의 문구·신규 카테고리 금지) */
const ADD_LEDGER_EXPENSE_CATEGORIES = [
  '식비',
  '교통/차량',
  '쇼핑/뷰티',
  '주거/통신',
  '문화/여가',
  '건강/병원',
  '이자/금융수수료',
  '카드대금 결제',
  '대출 상환',
  '기타 지출',
]
const ADD_LEDGER_INCOME_CATEGORIES = ['급여', '부수입', '금융 수입', '기타 수입']
const ADD_LEDGER_ALL_CATEGORIES = [...ADD_LEDGER_EXPENSE_CATEGORIES, ...ADD_LEDGER_INCOME_CATEGORIES]
const EXPENSE_CATEGORY_SET = new Set(ADD_LEDGER_EXPENSE_CATEGORIES)
const INCOME_CATEGORY_SET = new Set(ADD_LEDGER_INCOME_CATEGORIES)

function addLedgerCategoryEnumBlock() {
  return `【add_ledger_entry — 카테고리 고정 Enum(반드시 이 명칭만)】
- type=EXPENSE(지출)일 때 **category** 는 다음 중 **정확히 하나**만: ${ADD_LEDGER_EXPENSE_CATEGORIES.join(', ')}
- type=INCOME(수입)일 때 **category** 는 다음 중 **정확히 하나**만: ${ADD_LEDGER_INCOME_CATEGORIES.join(', ')}
[카테고리 매핑 룰] 가계부에 새로 등록할 때 유저의 지출/수입 내용을 해석해 **위 지정 분류 중 한 가지**로만 택해라. **절대** 임의의 카테고리 문구를 새로 만들지 마라. 애매하거나 끼는 분류가 없으면 type에 맞게 **'기타 지출'** 또는 **'기타 수입'**을 써라.
- **이자/금융수수료** = 할부 이자, 리볼빙·연체료, 카드 수수료 등 **빚을 줄이는 돈이 아닌** 비용(예산·소비에 탄다).
- **카드대금 결제** / **대출 상환** = 통장에서 나가 **부채를 갚는** 납부(빌린 원금/청구액). 일상 "쇼핑" 지출이 아님(앱이 예산·소비 통계에서 별도 처리).
(참고) query_ledger·기존 원장에 나온 옛 카테고리명은 **조회·필터**에 쓰일 뿐이며, **add_ledger_entry 로 새로 쌓는 건** 항상 위 Enum만 쓴다.`

}

function todayIsoDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildStructuredParseSystemPrompt(today, accounts) {
  const accountHint = accounts.length ? accounts.join(', ') : '없음'
  return `너는 금고지기(Vault Keeper) 앱의 AI 비서다.
유저 메시지에서 "새 거래를 기록하려는 의도"를 구조화한다.
출력은 반드시 JSON object 하나만 반환한다. 설명/코드블록/추가 문장 금지.

[판별 규칙]
- 새 거래 기록 의도(기록/입력/써줘/지출했다/입금됐다 등)이면 is_financial_data=true
- 조회/수정/삭제/집계/차트 요청, 일반 대화, 감탄문이면 is_financial_data=false

[기록 필수 3요소 + 선택 1요소]
- 필수: category(분류), summary(적요), amount(금액)
- 선택: account(계정/결제수단)
- memo는 선택
- 필수 3요소 중 누락/모호가 하나라도 있으면:
  - is_complete=false
  - missing_fields에 필드명 추가
  - extracted_data 해당 필드를 null
  - cfo_message에 누락 필드 질문 작성(추상 멘트 금지)

[카테고리 Enum - 반드시 아래 중 하나]
${ADD_LEDGER_ALL_CATEGORIES.join(', ')}

[계정(account) 처리]
- 유저가 결제수단/입금계좌를 말하지 않으면 account=null
- "은행이체/계좌이체"처럼 모호하면 account=null
- account가 null이어도 다른 필수값이 완전하면 is_complete=true 로 둔다(등록 후 계정 보완 질문은 클라이언트가 처리)
- 참고 가능한 기존 계정 목록: ${accountHint}

[날짜(date)]
- 형식: YYYY-MM-DD
- 텍스트에 날짜가 없으면 오늘(${today})을 사용

[응답 JSON 스키마]
{
  "is_financial_data": boolean,
  "is_complete": boolean,
  "missing_fields": ["account", "category"],
  "extracted_data": {
    "date": "YYYY-MM-DD",
    "amount": 0,
    "category": "Enum 값 또는 null",
    "summary": "가맹점/적요 또는 null",
    "account": "계정명 또는 null",
    "memo": "선택 메모 또는 null"
  },
  "cfo_message": "is_complete=false면 누락 질문, true면 팩트라인+CFO 코멘트"
}`
}

function parseJsonObjectStrict(text) {
  try {
    return JSON.parse(String(text || ''))
  } catch {
    return null
  }
}

function normalizeStructuredResult(raw, today) {
  const fallback = {
    is_financial_data: false,
    is_complete: false,
    missing_fields: [],
    extracted_data: {
      date: today,
      amount: 0,
      category: null,
      summary: null,
      account: null,
      memo: null,
    },
    cfo_message: '거래 기록을 위해 날짜·금액·적요·계정을 알려 주세요.',
  }
  if (!raw || typeof raw !== 'object') return fallback

  const data = raw.extracted_data && typeof raw.extracted_data === 'object' ? raw.extracted_data : {}
  const amount = Math.abs(Number(data.amount))
  const categoryText = data.category == null ? '' : String(data.category).trim()
  const summaryText = data.summary == null ? '' : String(data.summary).trim()
  const accountText = data.account == null ? '' : String(data.account).trim()
  const memoText = data.memo == null ? '' : String(data.memo).trim()
  const dateText = data.date == null ? '' : String(data.date).trim()
  const normalizedDate = dateText || today

  const knownCategory =
    categoryText && (EXPENSE_CATEGORY_SET.has(categoryText) || INCOME_CATEGORY_SET.has(categoryText))
      ? categoryText
      : null
  const normalizedAmount = Number.isFinite(amount) ? amount : 0
  const normalizedSummary = summaryText || null
  const normalizedAccount = accountText || null

  const missing = []
  if (!knownCategory) missing.push('category')
  if (!normalizedSummary) missing.push('summary')
  if (!(normalizedAmount > 0)) missing.push('amount')

  const declaredMissing = Array.isArray(raw.missing_fields)
    ? raw.missing_fields.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const mergedMissing = Array.from(new Set([...declaredMissing, ...missing]))
  const blockingMissing = mergedMissing.filter((f) => f !== 'account')
  const isFinancial = raw.is_financial_data === true
  const isComplete = isFinancial && blockingMissing.length === 0

  let cfoMessage = String(raw.cfo_message || '').trim()
  if (!cfoMessage && isFinancial && !isComplete) {
    if (mergedMissing.includes('account')) {
      cfoMessage = `기록을 마무리하려면 결제/입금 계정이 필요해요. 어떤 수단(예: 국민카드, 현금, 신한통장)이었나요?`
    } else if (mergedMissing.includes('summary')) {
      cfoMessage = '어디에 쓰거나 받으셨는지(적요/가맹점) 알려 주세요.'
    } else if (mergedMissing.includes('amount')) {
      cfoMessage = '정확한 금액(원)을 알려 주세요.'
    } else if (mergedMissing.includes('category')) {
      cfoMessage = `카테고리를 알려 주세요. (${ADD_LEDGER_ALL_CATEGORIES.join(', ')})`
    } else {
      cfoMessage = '기록을 위해 누락 정보를 조금만 더 알려 주세요.'
    }
  }

  return {
    is_financial_data: isFinancial,
    is_complete: isComplete,
    missing_fields: mergedMissing,
    extracted_data: {
      date: normalizedDate,
      amount: normalizedAmount,
      category: knownCategory,
      summary: normalizedSummary,
      account: normalizedAccount,
      memo: memoText || null,
    },
    cfo_message: cfoMessage,
  }
}

async function runStructuredEntryParser(apiKey, userText, dbContext) {
  const today = todayIsoDate()
  const accounts = Array.isArray(dbContext?.accounts)
    ? dbContext.accounts.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const body = {
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      { role: 'system', content: buildStructuredParseSystemPrompt(today, accounts) },
      { role: 'user', content: String(userText || '').slice(0, 4000) },
    ],
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const payload = await res.json()
  const content = payload?.choices?.[0]?.message?.content
  const parsed = parseJsonObjectStrict(content)
  return normalizeStructuredResult(parsed, today)
}

function inferTypeFromCategory(category) {
  const c = String(category || '').trim()
  if (INCOME_CATEGORY_SET.has(c)) return 'INCOME'
  return 'EXPENSE'
}

function buildAddLedgerToolCallFromStructured(structured) {
  const d = structured?.extracted_data || {}
  return {
    id: `call_add_${randomIdPart()}`,
    type: 'function',
    function: {
      name: 'add_ledger_entry',
      arguments: JSON.stringify({
        type: inferTypeFromCategory(d.category),
        category: d.category,
        amount: Number(d.amount),
        date: d.date,
        summary: d.summary,
        detail_memo: d.memo || undefined,
        account: d.account,
      }),
    },
  }
}

function buildIntentRouterSystemPrompt() {
  return `너는 지기방 요청 라우터다. 유저의 마지막 문장을 보고 intent를 분류한다.
출력은 JSON object 하나만.

intent enum:
- create_entry: 새 거래 기록/입력/등록 의도
- delete: 삭제 의도
- query: 조회/검색/목록/합계 확인
- update: 기존 거래 수정/변경
- analyze: 통계/분석/순위
- visualize: 차트/시각화
- chat: 일반 대화/기타

rules:
- 모호하면 chat
- 거래 "기록" 의미가 강하면 create_entry
- 절대 설명 문장 금지

JSON:
{
  "intent": "create_entry|delete|query|update|analyze|visualize|chat",
  "confidence": 0.0,
  "reason": "짧은 내부 근거"
}`
}

function normalizeIntentName(rawIntent) {
  const t = String(rawIntent || '').trim().toLowerCase()
  if (
    t === 'create_entry' ||
    t === 'delete' ||
    t === 'query' ||
    t === 'update' ||
    t === 'analyze' ||
    t === 'visualize' ||
    t === 'chat'
  ) {
    return t
  }
  return 'chat'
}

async function runIntentRouter(apiKey, userText) {
  const body = {
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0,
    messages: [
      { role: 'system', content: buildIntentRouterSystemPrompt() },
      { role: 'user', content: String(userText || '').slice(0, 2000) },
    ],
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { intent: 'chat', confidence: 0 }
  const payload = await res.json()
  const content = payload?.choices?.[0]?.message?.content
  const parsed = parseJsonObjectStrict(content)
  if (!parsed || typeof parsed !== 'object') return { intent: 'chat', confidence: 0 }
  return {
    intent: normalizeIntentName(parsed.intent),
    confidence: Number(parsed.confidence) || 0,
  }
}

function buildIntentOverrideSystemMessage(intent, userText) {
  const text = String(userText || '').slice(0, 400)
  if (intent === 'delete') {
    return {
      role: 'system',
      content: `【라우팅 오버라이드: 삭제 요청】이번 사용자 발화는 삭제 의도다.
- 반드시 도구를 먼저 사용한다: query_ledger -> delete_ledger(필요 횟수만큼 반복)
- 삭제는 바로 실행하지 말고, query_ledger 결과를 요약해 먼저 확인받아라.
- 확인 문구 형식: "OO 소스에서 총 N건(₩합계)을 찾았습니다. 모두 삭제할까요?"
- "다른 방 전달" 또는 이동 링크 출력 금지
- "입력한/가져온/샘플/시트" 같은 출처 힌트가 있으면 query_ledger의 location(소스 라벨) 필터를 우선 활용
- 고유명사(헬스장/스타벅스/쿠팡 등)는 category보다 merchant 파라미터를 우선 사용
- 사용자 발화: ${text}`,
    }
  }
  if (intent === 'query') {
    return {
      role: 'system',
      content: `【라우팅 오버라이드: 조회 요청】이번 사용자 발화는 조회 의도다.
- 반드시 query_ledger(또는 분석이면 analyze_category_spending)를 먼저 호출
- 고유명사 검색어는 category보다 merchant에 우선 배치
- 결과가 0건이면 "없다" 단정 전에 필터를 완화해 최대 2회 재시도한 뒤 답해라.
- 사용자 발화: ${text}`,
    }
  }
  if (intent === 'update') {
    return {
      role: 'system',
      content: `【라우팅 오버라이드: 수정 요청】이번 사용자 발화는 수정 의도다.
- query_ledger로 대상 식별 후 update_ledger 호출
- 사용자 발화: ${text}`,
    }
  }
  if (intent === 'analyze') {
    return {
      role: 'system',
      content: `【라우팅 오버라이드: 분석 요청】이번 사용자 발화는 분석 의도다.
- 반드시 analyze_category_spending을 먼저 호출
- 사용자 발화: ${text}`,
    }
  }
  if (intent === 'visualize') {
    return {
      role: 'system',
      content: `【라우팅 오버라이드: 시각화 요청】이번 사용자 발화는 시각화 의도다.
- 반드시 render_visualization을 먼저 호출
- 사용자 발화: ${text}`,
    }
  }
  return null
}

function loadApiKey() {
  const envKey = process.env.OPENAI_API_KEY
  if (envKey) return envKey
  try {
    const envPath = path.resolve(process.cwd(), '.env')
    const content = fs.readFileSync(envPath, 'utf-8')
    const match = content.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m)
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : null
  } catch {
    return null
  }
}

// ─── 시스템 프롬프트 (요청 시점의 날짜를 동적으로 주입) ──────────────────────
function buildSystemPrompt() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevYearMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`

  return `너는 Vaulter의 유능하고 싹싹한 재무 비서다.
오늘 날짜: ${dateStr} (${yearMonth}). 기간 추론·원장 \`date\` 계산 시 **오늘 = 이 날(서버/요청 기준 0시대)** 를 **절대 기준**으로 삼아라.
"이번 달" = ${yearMonth}, "지난 달" = ${prevYearMonth}.

**【등록 \`add_ledger_entry\` — 상대·구어 날짜 → YYYY-MM-DD(직접 환산)】**
- 유저가 **"오늘" "어제" "그제" "엊그제" "이틀 전" "사흘/삼일 전"** 또는 **"N일 전"** **"일주일 전"** **"2주 전"** · **"지난주 월/화/…요일"** (맥락상 이번 주가 아닌 지난주로 해석될 때) 등 **캘린더를 가리키는 말**을 하면, **위 "오늘"** 에서 **역산·계산**해 \`date\` 에 **한 번에** 넣는다.
- **"삼일 전"** 같이 **이미 약속된 날짜**가 **말에 들어 있으면**, **정확한 날짜를 유저에게 되묻지 말 것** (원장 \`date\` 칼럼이 이미 구체 일자).
- **날·일자 힌트가 전혀 없을 때만** (금액·가맹만 있고 "언제"가 불가역할 때) **어느 날**인지 **짧게** 역질문.
- "작년" "3월"처럼 **연·월**만 말한 경우, 일자가 **불가역**이면 1일 등으로 보거나 **최소한만** 묻는다(본 규칙의 기본은 **상대·구어 = 알아서 YYYY-MM-DD**).

${addLedgerCategoryEnumBlock()}

【신용카드·할부 — 팩트 폭격 & 수수료 분리】
- 유저가 **신용카드/체크/카드로 결제**했다고 말하거나(가맹점·영수증에 카드로 드러남) **일상 지출**로 기록한 뒤, **꼭 한 문장**을 덧붙인다. 요지: "₩(금액) 지출 반영. **이번에 갚을 단기 외상(카드 빚)**이 **그만큼** 늘었다" (유저·거래에 맞는 **숫자** 사용, 과한 협박·장난 금지, 사실만).
- 카드/대출 **청구서·이메일**에 **할부이자·수수료·이자**가 따로 잡혀 있으면 **절대** 일반 지출과 합쳐서 한 줄로 쓰지 말고, **이자/금융수수료**로 **별도 add_ledger_entry** (총 청구액에서 원금(상환) 이자(수수료)를 쪼갤 수 있으면 2회 이상 호출). 원금/청구 대금 **납부**는 **카드대금 결제** 또는 (대출이면) **대출 상환**으로 기록.
- "카드값 냄/자동이체" 등 **빚을 갚는** 이야기는 **카드대금 결제** (일상 쇼핑 지출 category와 혼동하지 말라).

【원장(가계부) 새 거래 등록 — Slot-filling / 스마트 역질문】
- 유저가 "기록해줘/넣어줘/원장에 써줘/가계부에 올려줘/썼어 기록" 등 **새 거래를 원장에 반영**하려는 의도일 때, **아래 [필수 4요소]를 모두 충족(또는 합리적으로 도출)할 수 있을 때에만** \`add_ledger_entry\` 를 호출해라.
- 4요소를 모두 갖췄거나(또는 역질문으로 보충) 기록 의도가 유지되면 **add_ledger_entry** 로 즉시 등록하고, **가맹(적요)**·금액 기준으로 **짧게** 보고해라(장문·원장 풀서술 금지).
- **금액·날짜(또는 환산 가능한 상대일 표현)·적요(\`summary\`) 중 하나라도 없으면** add_ledger_entry를 **절대** 호출하지 말고, 부족한 것만 **다정·짧게** 역질문해라. (상대일·구어 **말**이 있으면 "날짜 없음"이 아님 — **위 【상대·구어 날짜】**로 채움)
- **카테고리는 별도 항목**이지만(아래 4번), [스마트 역질문 룰]에 따라 묻지 않고 Enum으로 매핑해도 되는 경우가 있다.
- **【\`summary\` 적요 / \`detail_memo\` 메모 — 역할 고정(UX)】** 사람이 볼 때 **먼저** "어디서/어느 가맹(누구에게)"인지 → **\`summary\`**. **무엇(메뉴·품목·라인)** → **\`detail_memo\`**. **역할 뒤집지 말 것.** (예: 적요=**미성식당**, 메모=**보리밥** — ❌적요=보리밥 / 메모=오늘 미성식당에서)
- **\`summary\` (적요·필수):** **가맹·상호·장소(식당·편의점·앱/쇼핑몰)** 를 **최우선**. "미성식당", "이마트", "쿠팡". **택시/교통**이면 **구간·승차** 키워드. **가맹을 알 수 없을 때만** **품목·용도** 한 줄(떡볶이, 구독). **서술어·"에서"** 금지. **"지기"·"AI"** 금지. **영수증/카드명세** 는 보통 **가맹(사업자명/가맹점)=적요**, **품목/라인=메모** — **메뉴를 적요에 둘 이유는 거의 없음.**
- **\`detail_memo\` (메모, 선택·권장):** **메뉴·품목·옵션**(보리밥, 아이스아메리카노), **영수증 품목** 등. **"점심으로" "저녁에" "아침에"** 처럼 **끼니(점심·저녁·아침·야식·브런치·밤 등)** 는 **캘린더 날짜가 아니라** "언제 층의 식사인지"이므로 **\`detail_memo\`에 둔다** — \`summary\`에 쓰지 말 것. **형식:** \`품목, 끼니\` **쉼표**로 — 예: \`보리밥, 점심\` · \`돼지갈비, 저녁\` · \`빵, 아침\`. (동일 정보 중복·장문은 피할 것) **"오늘" "어제" "이번 달"** 은 **날짜와 중복**이므로 **절대 넣지 말 것**. "오늘 미성식당에서" 같은 **서술 문장** 금지 → 가맹은 \`summary\`만. **추가**로 쓸 게 없으면 **생략**.
- **account(계정/결제수단):** 유저가 **현금/카드/이체/통장**을 말했을 때만 \`add_ledger_entry\` 의 **account**에 넣는다(또는 dbContext "등록된 계정"과 일치시킨다). **말하지 않았으면 파라미터 생략·비움.**
- add_ledger_entry **tool 응답**에 \`need_account_clarify: true\` 가 있으면, **그 턴** 답은 **(1) 팩트 (2) 결제 질문** **두 가지만**. **(1)** tool JSON에 \`fact_line\` 이 있으면 **띄어쓰기·쉼표까지 포함해** 그대로 **첫 줄**에 출력(클라: YYYY-MM-DD, 적요, 메모(있을 때), ₩, 카테고리). \`fact_line\` 이 없을 때만 tool의 \`summary\` 객체(날짜·\`memo\`·\`detail_memo\`·금액·카테고리)로 **한 줄**을 직접 쓴다 — **"확인" 같은 빈말만 금지**. 예: \`2026-04-26, 미슐랭, 보리밥, ₩19,000, 식비.\` **(2)** \`현금이었나요, 카드였나요?\` (또는 \`결제는 현금/카드?\`) — **"날짜는 확인했으니"**·**"적요와 금액은 확인"** 류 **절대 금지**.
- 등록 대기 중에는 **절대** query_ledger / analyze_category_spending / update_ledger / render_visualization 을 "등록 대용"으로 쓰지 마라.

**[필수 4요소 확인]**
1) **적요(가맹·장소 우선)** — \`summary\`에 **위 "역할 고정"** 적용(식사면 **식당명**이면 메뉴는 \`detail_memo\`).
2) **정확한 금액** — 숫자(원). "대략/적당히"만으로는 불충분.
3) **날짜** — "오늘/어제/4월 10일" 등 (상대일은 **위의 오늘 날짜** 기준)
4) **category** — 위 【add_ledger_entry — 카테고리 고정 Enum】의 **type(EXPENSE/INCOME)에 맞는 명칭 정확히 하나**. 임의 신규 분류·비Enum 문자열 금지.

**[스마트 역질문 룰]**
- **금액 / 날짜(환산 전)** / **적요(키워드)** — **이 세 가지** 중 **채울 수 없는 것**이 있으면 → **add_ledger_entry를 호출하지 말고** 역질문. (단, **날짜**는 "오늘" "어제" **"삼일 전"** **"N일 전"** 등 **구어·상대 표현**이면 **절대 기준일로 YYYY-MM-DD 환산** = **"날짜가 있다"**고 본다. **이때는 정확한 일을 되묻지 말 것.**)
- **카테고리 추론:** 국밥·편의점·커피·배달 식사 등 ➔ **식비**, 택시·지하철·버스·주차 등 ➔ **교통/차량**, 온라인 쇼핑·화장품 등 ➔ **쇼핑/뷰티**처럼 **유저 말에서 Enum으로 넣을 분류가 확실하면 카테고리를 굳이 묻지 말고** 곧바로 tool의 category에 넣어라(수입이면 "급여/부수입/금융 수입" 등 맥락에 맞게).
- **가맹점명 기반 추론 강화:** 상호가 \`식당/분식/국밥/밀면/냉면/칼국수/김밥/치킨/피자/버거/카페/커피/베이커리/본죽/본도시락\` 류이거나 \`~본점\`, \`~점\` 형태의 **음식점 맥락**이면 기본을 **식비**로 둔다. 예: \`두레밀면본점\`, \`홍콩반점\`, \`OO국밥\`.
- **카테고리만** 발화가 너무 애매해 **지출·수입 각 Enum 중 어디에 넣을지 확신할 수 없을 때에만** 예를 들어 "이 지출은 어떤 카테고리(식비, 쇼핑/뷰티, 교통/차량 등)로 맞을까요?" / 수입이면 "(급여, 부수입 …)" 식으로 **똑똑하게 한 번만** 물어라. (여전히 애매하면 type에 맞게 **'기타 지출'** 또는 **'기타 수입'** — 상단 Enum 룰과 동일.)

**[역질문·톤 — 모순(환각) 금지 & 카테고리 과잉 확인 금지]**
- **금액/날짜 등 누락 시 모순된 화법 금지:** 아직 유저가 **말해 주지 않은** 항목이 있으면, "확인했는데" "금액은 이미 아는데" 같이 **이미 안다는 전제** 를 깔지 마라(환각). **부족한 말만** 짧게 묻는다. 잘못된 예: "금액과 날짜는 확인했는데, 택시 요금이 얼마인지…" (금액을 모르면 '확인'이라고 말하면 안 됨) → **올바른 예:** "택시비가 얼마였는지 알려주시겠어요?" / **"날짜는 언제였을까요?"** 는 **날짜 힌트(상대일·오늘/어제 등)가 전혀 없을 때만** (유저가 "삼일 전"을 말했는데 **정확한 일**을 다시 묻는 것 = 잘못)
- **카테고리 '결재'·사전 확인 금지(핵심):** 택시·버스·지하철·주차 → **교통/차량**, 밥·국밥·편의점·커피 → **식비**, 월급·급여 입금 → **급여** 등 **누가 봐도 상식적으로 한 가지로 떨어지는 경우** "교통/차량으로 넣어도 될까요?" "식비로 맞을까요?" 처럼 **유저에게 재승인을 구하지 말고**, 금액·날짜·\`summary\`(적요)만 갖추면 **즉시** \`add_ledger_entry\` 를 호출해라.
- **역질문으로 카테고리를 묻는 것**은 "다이소 5천원"처럼 **해당Enum 중 어디에 넣을지 정말로 판단이 안 설 때**만 상단 [스마트 역질문 룰]에 따라 1문장. 확실하면 묻지 말 것.

【등록·역질문 대화 예시】
(예시 A) 유저: "편의점에서 우유랑 샌드위치 샀어, 7,500원" → (날짜 없음) **도구 호출 없이** "어느 날 쓰셨는지 알려주시겠어요? (오늘/어제/날짜)" — 카테고리는 **식비**로 확정 가능하므로 묻지 않음.
(예시 B) 유저: "돈 많이 썼어" → **도구 없이** 내용·금액·날짜(필요 시 카테고리)를 **짧고 다정하게** 요청.
(예시 C) 유저: "어제 3천원 썼어" → (내용 없음) **도구 없이** "어디/무엇에 쓰셨는지 알려주시겠어요?"
(예시 D) 유저: "현금 5천원, 어제, 뭔가 샀다" → 내용·카테고리 모호 → 내용·또는 카테고리를 위 스마트 룰대로 **필요한 것만** 묻기.

【채팅 답변 — 짧고 직관(필수)】
- **서론·절차·추상 확인 금지:** "…기록하기 위해", "날짜는 확인했으니", "적요와 금액은 확인되었습니다", "확인된 항목은…" — **수치·이름** 없이 "확인"만 말하는 문장 **금지**. 항상 **날짜(YYYY-MM-DD)**·**적요**·**메모(없으면 생략)**·**₩금액**·**카테고리(한글 Enum)** 를 **채팅에 직접** 찍는다.
- **팩트 한 줄 + (필요 시) 질문 한 줄:** 첫째 줄에 예: \`2026-04-25, 홍성식당, 돼지국밥, ₩9,000, 식비.\` / 둘째 줄에 \`결제는 현금 / 카드?\` 를 붙인다. \`need_account_clarify\` 이면 **질문보다 먼저** **팩트 한 줄**(가능하면 tool의 \`fact_line\`) **필수** — 질문만 쓰기 금지.
- **등록·확인**은 **2~4문장** 이내. **반복·정중 과잉** 금지.
- **"오늘" "어젯밤"** 같이 **캘린더를 가리키는 말**은 **메모·적요에 쓰지 말고**, **팩트 줄**의 \`date\` 만. **"점심" "저녁"** 은 **끼니 태그** → \`detail_memo\` (\`…, 점심\`).

【핵심 행동 규칙】
1. **조회·수정·삭제·분석·시각화** 요청(위 등록 케이스가 아닐 때)에는 반드시 도구(function)를 먼저 호출하고, 실제 데이터를 확인한 뒤 답변해라. **삭제**(지워줘/삭제해/N건/가계부 샘플 등): \`query_ledger\` 로 대상을 찾을 때 **시트·가져오기 출처**가 있으면 **location(=소스 라벨)** 파라미터(예: \`가계부\`, \`샘플\`, 시트 파일명 일부)를 쓴다. **삭제 건수 규칙:** 사용자가 말한 숫자(예: "10건")와 **반드시 일치**해야 한다면, 먼저 \`query_ledger\` 의 **count**가 그 숫자와 같은지 확인하고, **그 결과 집합의 id만** \`delete_ledger\` 로 넘긴다. count가 다르면 사용자에게 숫자 불일치를 짧게 알리고 삭제 도구를 호출하지 마라. 대상 id가 확정되면 **id마다** \`delete_ledger\` 를 한 번씩 호출한다. **클라이언트 동작:** 각 \`delete_ledger\` 결과에 \`user_confirmation_pending: true\`가 있으면 **실제 삭제는 아직 아니다**. 채팅에 **예/아니오 칩**이 뜨므로, 자연어에서는 **"삭제했다"고 말하지 말고** 칩에서 **예**를 누르라고 안내한다. 최종 삭제 완료 건수는 **삭제 확인 목록에 표시된 행 수**(=중복 없는 delete_ledger 호출 수)와 같아야 한다 — 서로 다른 숫자를 한 턴에 말하지 마라. **"지기 방으로 이동" 링크는 쓰지 말 것**(삭제는 지기 본인 업무). 등록 의도인데 **[필수 4요소]가** 미비하면(스마트 추론으로도 못 채울 때) 규칙 1의 삭제/조회 부분을 **적용하지 말고** add_ledger_entry·다른 tool 호출을 하지 않는다.
2. 절대로 데이터를 지어내거나 추측하지 마라.
3. **query_ledger 절대 준수(환각 차단):** 도구 결과의 **\`count\`**, **\`totalSumAbs\`(합계 ₩표기에 사용)**, 그리고 **\`appliedFiltersEcho\`**만 집계·필터의 진실이다. **\`summary\` 문자열의 건수·합계를 사용자 답변에 그대로 써야 한다.** 사용자가 말한 계정명·카드명이 **실제 호출 인자의 \`account\`에 채워지지 않았다면**, 그 이름으로 「○○ 계정 거래」처럼 말해서는 안 된다. 대신 어떤 조건으로 조회했는지 한 줄 적고 모호하면 짧게 확인 질문을 하라. **\`location\`에는 "가계부/원장/금고/앱" 같은 전체 명칭을 넣지 마라**(소스 라벨이 아님). 유저가 \`appliedFiltersEcho.location\`이 비었다면 "가계부에 등록된 거래만"처럼 **소스 한정 표현 금지**. **한 사용자 메시지에서**(예: "4월에 몇 개고 기업법인 계정은 몇 개?"처럼) **월·기간 요약 숫자**와 **특정 계정 건수**를 동시에 묻거든, 같은 \`startDate\`/\`endDate\`로 **\`account\` 미지정 query_ledger 한 번**, 그 다음 **\`account\`에는 등록된 계정 목록의 문자열 원문**(예: 기업법인_직불카드 전체)·또는 \`ambiguousAccounts\` 처리된 뒤 **확정한 한 줄을 넣은 query_ledger 한 번** 이상 필요하며, **미필터 전체 결과에서 계정별로 임으로 쪼개어 숫자를 지어내지 마라**.
4. **\`ambiguousAccounts\`가 넘어오면** 사용자에게 등록 목록 중 **어느 계정으로 한정할 것인지 반드시 물어라.** 임으로 하나를 선택해 집계하지 마라.
5. query_ledger 실행 후 개별 거래 내역이나 중간 계산 과정을 채팅창에 나열하지 마라.
   → 통상 아래 형식으로만 답변해라 (단 **건수·합계는 오직 도구 결과 summary 또는 count/totalSumAbs**):
   "N월 … 내역은 총 X건이며, 합계는 ₩YYY입니다. 상세 내역은 왼쪽 원장 화면에 표시해두었습니다."
6. 통계·분석 질문("제일 많이 쓴 카테고리", "카테고리별 요약", "합계" 등)에는 query_ledger가 아니라 반드시 analyze_category_spending을 호출해라.
   → 연산 결과는 클라이언트가 이미 계산해서 넘겨주므로, GPT는 절대 직접 수학 계산을 하지 마라.
   → tool 결과의 topCategory, topAmount를 그대로 읽어 단 한 줄로 브리핑해라.
   예) "가장 지출이 큰 카테고리는 식비로, 총 ₩69,000입니다. 상세 내역은 왼쪽 원장에 표시해두었습니다."
7. 결과가 0건이면 tool 결과의 _db.categories 목록을 참고해 비슷한 카테고리를 제안하되, **반드시** "어떤 필터(기간/카테고리/상호/계정/소스)로 찾았는지"를 먼저 한 줄로 공개해라.
8. analyze_category_spending 결과를 받아 topCategory가 있으면, 답변 끝에 반드시 다음 태그를 붙여라 (렌더링 안 됨):
   [WINNER_CATEGORY:카테고리명]
   예) "가장 많이 쓴 카테고리는 식비입니다. [WINNER_CATEGORY:식비]"
9. 말투는 **짧고 직관**. 상단 **【채팅 답변 — 짧고 직관】** 우선. 한국어로만 답변해라.
10. 금액은 반드시 ₩ 기호와 천 단위 구분 쉼표를 사용해라.
11. 유저가 "자금 흐름도", "흐름도", "차트", "시각화", "Sankey" 등을 요청하면 반드시 render_visualization을 호출해라.
${interRoomSystemSuffixForKeeper()}`
}

// ─── Tool 스키마 ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_ledger',
      description:
        '원장(가계부)에서 거래 내역을 검색합니다. 기간·카테고리·가맹·**소스(입력/문서/Gmail/연동, 파일명 포함)** 등으로 필터링할 수 있다. 삭제 전 대상을 찾을 때 사용한다.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description:
              '**(선택)** 좁히고 싶을 때만. 거래 행의 **실제 소스/출처 라벨**(문서 업로드, Gmail, webhook, 특정 파일명 일부 등)과 부분 일치 검색이다. 유저 발화만 "가계부/원장/금고 전체 중 4월" 정도면 **비워 둠** — "가계부" 문자열 자체가 소스가 아니며 넣으면 Gmail·카드내역까지 0건으로 나올 수 있다.',
          },
          startDate: {
            type: 'string',
            description: '조회 시작 날짜 (YYYY-MM-DD). 예: 2026-04-01',
          },
          endDate: {
            type: 'string',
            description: '조회 종료 날짜 (YYYY-MM-DD). 예: 2026-04-30',
          },
          category: {
            type: 'string',
            description: '카테고리 필터 (부분일치). Enum/기존 카테고리가 명확할 때만 사용. "헬스장/스타벅스/쿠팡" 같은 고유명사는 merchant에 우선 넣어라.',
          },
          excludeCategories: {
            type: 'array',
            items: { type: 'string' },
            description: '제외할 카테고리 목록. 예: ["쇼핑","구독"] → 해당 카테고리 거래를 결과에서 제외',
          },
          account: {
            type: 'string',
            description:
              '계정(결제수단) 필터. **등록된 계정 목록 문자열 그대로(또는 명확한 부분일치 한 번)** 우선. 사용자가 "기업법인 카드" 등이라고 했으면 목록에서 해당 한 줄을 골라 account에 넣어라. 애매하면 거짓 확정 금지: 빈 채로 조회 후 0건·역질문 또는 ambiguousAccounts 분기를 쓴다.',
          },
          merchant: {
            type: 'string',
            description: '가맹점/상호/고유명사 검색어 (부분일치). 예: 헬스장, 스타벅스, 쿠팡. category보다 우선.',
          },
          minAmount: {
            type: 'number',
            description: '최소 금액 (절댓값 기준)',
          },
          maxAmount: {
            type: 'number',
            description: '최대 금액 (절댓값 기준)',
          },
          type: {
            type: 'string',
            enum: ['expense', 'income'],
            description: '거래 유형 필터. expense=지출(음수), income=수입(양수). "지출", "쓴 돈" 등은 expense로 전달해라.',
          },
          sortBy: {
            type: 'string',
            enum: ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'],
            description: '정렬 기준. "제일 큰/많은" → amount_desc, "제일 작은" → amount_asc, 기본값은 date_desc',
          },
          limit: {
            type: 'number',
            description: '반환할 최대 건수 (기본값 20, 최대 100)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_category_spending',
      description:
        '카테고리별 지출 합산·순위를 분석한다. "가장 많이 쓴 카테고리", "카테고리별 지출 요약", "N위가 뭐야" 등 통계/분석 질문에는 query_ledger 대신 반드시 이 함수를 호출해라. 연산은 클라이언트가 직접 처리하므로 GPT는 수학적 계산을 하지 않아도 된다.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: '조회 시작 날짜 (YYYY-MM-DD)' },
          endDate:   { type: 'string', description: '조회 종료 날짜 (YYYY-MM-DD)' },
          excludeCategories: {
            type: 'array',
            items: { type: 'string' },
            description: '집계에서 제외할 카테고리 목록. 예: ["쇼핑","구독"]',
          },
          type: {
            type: 'string',
            enum: ['expense', 'income'],
            description: 'expense=지출만, income=수입만. 생략 시 지출 기준으로 집계',
          },
          topN: {
            type: 'number',
            description: '상위 N개 카테고리만 반환. 기본값 5',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'render_visualization',
      description:
        '지출 분석 시각화(도넛 차트) 화면을 열고 특정 기간 데이터를 표시한다. 유저가 "흐름도", "차트", "시각화", "지출 분석" 등을 요청하면 반드시 호출해라. 기간이 언급되면 startDate/endDate를 계산해서 전달해라.',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: '조회 시작 날짜 (YYYY-MM-DD). 예: "3월" → 2026-03-01',
          },
          endDate: {
            type: 'string',
            description: '조회 종료 날짜 (YYYY-MM-DD). 예: "3월" → 2026-03-31',
          },
          label: {
            type: 'string',
            description: '차트 상단에 표시할 기간 레이블. 예: "3월", "지난달", "최근 7일"',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_ledger',
      description:
        '특정 거래의 카테고리·또는 계정(결제수단)을 수정합니다. **category**와 **account** 중 **하나 이상**을 넣는다.',
      parameters: {
        type: 'object',
        properties: {
          txId: {
            type: 'string',
            description: '수정할 거래의 ID (query_ledger 결과의 id 필드, 또는 add_ledger_entry 직후 tool이 돌려준 id)',
          },
          category: {
            type: 'string',
            description: '새 카테고리 (Enum, 변경할 때만). 그대로 둘 거면 생략.',
          },
          account: {
            type: 'string',
            description: '결제/입금 **계정**(현금, OO카드 …). 유저가 말로 확정한 값. 계정만 바꿀 때 사용.',
          },
        },
        required: ['txId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_ledger',
      description:
        '원장에서 삭제할 **후보 1건**을 등록합니다(클라이언트가 예/아니오 확인 후 실제 삭제). **여러 건**이면 query_ledger로 id 목록을 얻은 뒤 **이 도구를 id마다 반복 호출**한다. 도구 응답에 user_confirmation_pending이 있으면 아직 삭제되지 않았음을 유저에게 안내한다.',
      parameters: {
        type: 'object',
        properties: {
          txId: {
            type: 'string',
            description: '삭제할 거래의 ID',
          },
        },
        required: ['txId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_ledger_entry',
      description:
        '필수: summary(적요: 가맹·장소 우선)·정확한 금액·date(YYYY-MM-DD; 오늘/어제/삼일 전/N일 전 등은 시스템 "오늘" 기준으로 직접 환산, 이 경우 날짜 되묻기 금지)·category(Enum). detail_memo=메뉴·품목(선택: 끼니는 "품목, 점심" 등 쉼표). "오늘/어제" 캘린더말은 메모 금지. 금액/날짜(환산 전)·summary 없으면 도구 금지.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['EXPENSE', 'INCOME'],
            description: 'EXPENSE=지출, INCOME=수입. category는 이 type에 맞는 Enum만.',
          },
          category: {
            type: 'string',
            enum: ADD_LEDGER_ALL_CATEGORIES,
            description: `type=EXPENSE: ${ADD_LEDGER_EXPENSE_CATEGORIES.join(' | ')}. type=INCOME: ${ADD_LEDGER_INCOME_CATEGORIES.join(' | ')}. 철자·띄어쓰기 동일해야 함.`,
          },
          amount: { type: 'number', description: '원 단위 양수. 절댓값이 기록됨(지출/수입은 type으로 구분).' },
          date: {
            type: 'string',
            description:
              '거래일 YYYY-MM-DD. 유저 "오늘/어제/그제/삼일·N일 전/이틀 전/…" 는 **요청 시점 오늘**에서 계산(되묻지 말 것).',
          },
          summary: {
            type: 'string',
            description:
              '**적요**: **가맹·상호·장소** 우선(미성식당, 쿠팡). 식사면 **식당명**. 메뉴(보리밥)는 detail_memo. 끼니(점심/저녁)는 detail_memo 태그. 오늘/어제/에서 금지.',
          },
          detail_memo: {
            type: 'string',
            description:
              '**메모**: **메뉴·품목**; 끼니가 있으면 `품목, 점심`·`…, 저녁` (쉼표). "오늘/어제" 캘린더 말은 금지. 가맹은 summary. 없으면 생략.',
          },
          account: {
            type: 'string',
            description: '현금/카드/이체/통장 등 **유저가 말한** 결제수단. **모르면 생략(비움).**',
          },
        },
        required: ['type', 'category', 'amount', 'date', 'summary'],
      },
    },
  },
]

// ─── 대화 길이 제한 (토큰 절약) ──────────────────────────────────────────────
const MAX_HISTORY_MESSAGES = 20

function sanitizeToolCallHistory(messages) {
  const out = []
  let pendingCallIds = null
  let pendingAssistantIndex = -1

  const dropPendingBlock = () => {
    if (pendingAssistantIndex >= 0) out.splice(pendingAssistantIndex)
    pendingCallIds = null
    pendingAssistantIndex = -1
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    const isAssistantToolCall =
      msg.role === 'assistant' &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0

    if (isAssistantToolCall) {
      if (pendingCallIds && pendingCallIds.size > 0) {
        // 이전 tool_call 블록이 완결되지 않았으면 블록 전체 제거
        dropPendingBlock()
      }
      const ids = msg.tool_calls
        .map((c) => c?.id)
        .filter((id) => typeof id === 'string' && id.trim())
      if (ids.length === 0) continue
      pendingAssistantIndex = out.length
      out.push(msg)
      pendingCallIds = new Set(ids)
      continue
    }

    if (msg.role === 'tool') {
      if (!pendingCallIds || pendingCallIds.size === 0) continue
      const callId = String(msg.tool_call_id || '').trim()
      if (!callId || !pendingCallIds.has(callId)) continue
      out.push(msg)
      pendingCallIds.delete(callId)
      if (pendingCallIds.size === 0) {
        pendingCallIds = null
        pendingAssistantIndex = -1
      }
      continue
    }

    // 일반 메시지로 넘어가기 전에 미완결 tool_call 블록 제거
    if (pendingCallIds && pendingCallIds.size > 0) dropPendingBlock()
    out.push(msg)
  }

  // 끝까지 tool 결과가 안 온 병렬 호출 블록은 assistant(tool_calls)째 제거
  if (pendingCallIds && pendingCallIds.size > 0) dropPendingBlock()
  return out
}

function trimHistory(messages) {
  const sanitized = sanitizeToolCallHistory(messages)
  const sliced =
    sanitized.length <= MAX_HISTORY_MESSAGES
      ? sanitized
      : sanitized.slice(-MAX_HISTORY_MESSAGES)
  // 슬라이싱 경계에서 쌍이 깨지는 경우를 다시 정리
  return sanitizeToolCallHistory(sliced)
}

/** tool 응답 JSON이 라운드를 거칠 때마다 누적되면 페이로드·토큰이 폭증해 Netlify 초과→502 가능 */
const HISTORY_MAX_LEDGER_IDS = 45
const HISTORY_MAX_LEDGER_TX_SAMPLES = 12
const HISTORY_MAX_DB_CATEGORIES = 80

function deflateToolPayloadForHistory(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed
  const next = { ...parsed }

  if (Array.isArray(parsed.ranking) && parsed.ranking.length > 20) {
    next.ranking = parsed.ranking.slice(0, 20)
    next._historyNote =
      `${next._historyNote ? `${next._historyNote} · ` : ''}ranking은 상위 20개만 포함(전체 topN 결과는 클라 실행 요약 참고)`
  }

  const looksLedgerQuery =
    Array.isArray(parsed.allMatchingIds) ||
    (parsed.appliedFiltersEcho != null && typeof parsed.appliedFiltersEcho === 'object')

  if (looksLedgerQuery) {
    const idCount = Array.isArray(parsed.allMatchingIds) ? parsed.allMatchingIds.length : 0
    if (idCount > HISTORY_MAX_LEDGER_IDS && Array.isArray(parsed.allMatchingIds)) {
      next.allMatchingIds = [
        ...parsed.allMatchingIds.slice(0, HISTORY_MAX_LEDGER_IDS),
        `__OMITTED_ID_COUNT_TOTAL__:${idCount}`,
      ]
      next._historyNote = `${next._historyNote ? `${next._historyNote} · ` : ''}실제 매칭 id는 ${idCount}건(히스트리에는 길이·샘플만 유지)`
    }
    const txArr = parsed.transactions
    if (Array.isArray(txArr) && txArr.length > HISTORY_MAX_LEDGER_TX_SAMPLES) {
      next.transactions = txArr.slice(0, HISTORY_MAX_LEDGER_TX_SAMPLES)
      next._historyTxSampleOf = `${HISTORY_MAX_LEDGER_TX_SAMPLES}/${txArr.length}`
    }
    if (
      parsed._db &&
      Array.isArray(parsed._db.categories) &&
      parsed._db.categories.length > HISTORY_MAX_DB_CATEGORIES
    ) {
      next._db = {
        ...parsed._db,
        categories: parsed._db.categories.slice(0, HISTORY_MAX_DB_CATEGORIES),
        categoriesOmittedHint: `(+상위 정보용 ${parsed._db.categories.length - HISTORY_MAX_DB_CATEGORIES}개 생략)`,
      }
    }
    if (parsed.attempts?.length > 6) next.attempts = parsed.attempts.slice(-6)
  }

  return next
}

/** OpenAI 에 보내기 직전 — role=tool content(JSON)만 줄인 복본 */
function deflateMessagesForOpenAI(messages) {
  if (!Array.isArray(messages)) return messages
  return messages.map((m) => {
    if (!m || m.role !== 'tool' || typeof m.content !== 'string') return m
    const parsed = parseJsonObjectStrict(m.content)
    if (!parsed || typeof parsed !== 'object') return m
    try {
      return { ...m, content: JSON.stringify(deflateToolPayloadForHistory(parsed)) }
    } catch {
      return m
    }
  })
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' })
  }

  const apiKey = loadApiKey()
  if (!apiKey) {
    return json(500, { error: 'OPENAI_API_KEY가 설정되지 않았습니다.' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: '요청 형식이 올바르지 않습니다.' })
  }

  const { messages, dbContext } = body
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages 배열이 필요합니다.' })
  }

  const trimmedMessages = trimHistory(messages)
  const messagesForOpenAI = deflateMessagesForOpenAI(trimmedMessages)
  const tailMessage = trimmedMessages[trimmedMessages.length - 1]

  const accRaw = Array.isArray(dbContext?.accounts)
    ? dbContext.accounts.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const accDisplay =
    accRaw.length === 0 ? '없음' : accRaw.length <= 80 ? accRaw.join(', ') : `${accRaw.slice(0, 80).join(', ')} …(총 ${accRaw.length}개)`

  const catRaw = Array.isArray(dbContext?.categories)
    ? dbContext.categories.map((x) => String(x || '').trim()).filter(Boolean)
    : []
  const catDisplay =
    catRaw.length === 0 ? '없음' : catRaw.length <= 120 ? catRaw.join(', ') : `${catRaw.slice(0, 120).join(', ')} …(총 ${catRaw.length}개)`

  const lastUserMessage = [...trimmedMessages]
    .reverse()
    .find((m) => m && m.role === 'user' && typeof m.content === 'string')
  const latestUserText = String(lastUserMessage?.content || '').trim()

  // 유저 원장 현황을 별도 시스템 메시지로 주입 (매 요청마다 최신 상태 반영)
  const contextMessage = dbContext
    ? {
        role: 'system',
        content: `【현재 유저의 원장 데이터 현황】
- 등록된 계정(결제수단) 목록: ${accDisplay}
- 등록된 카테고리 목록(기존 원장에 쌓인 **과거/혼재** 분류, 조회·필터용): ${catDisplay}
- **한 질문에 "기간 전체 몇 건이고 OO 계정은 몇 건?"이 같이 들어있으면** query를 **두 번**(같은 날짜 범위, 첫 번째는 account 생략 / 두 번째는 account=\`위 목록의 정확한 한 줄\`).
- 총 거래 건수: ${dbContext.totalTransactions ?? 0}건
- 기간: ${dbContext.dateRange ?? '없음'}

query_ledger 호출 시 위에 있는 **계정·(기존)카테고리**를 검색/필터에 활용해도 좋다.
**중요:** \`location\` 파라미터는 거래별 **실제 소스 라벨**(예: 입력, Gmail, 연동, 시트 파일명 일부)**만** 좁힐 때 넣는다. **앱 전체를 뜻하는 "가계부", "금고", "원장", "데이터 원장"만으로는 소스 필터를 넣지 마라**(유저가 "가계부 전체 중 4월"처럼 말한 것처럼 보여도 해당 필드 금지). 유저 발화에서 **파일명·Gmail만·연동 등 구체 출처**가 명시된 경우에만 \`location\`을 채워라.

유저가 "현금"이라고 하면 계정 목록에서 일치하는 항목을 찾아 account 파라미터로 전달해라.
유저가 기존 원장 키워드로 "식비" 등을 말하면 category 필터는 위 목록과 맞출 수 있다.
유저 발화의 고유명사(헬스장/스타벅스/쿠팡/가게명)는 category로 억지 매핑하지 말고 merchant 파라미터를 우선 사용해라.

**add_ledger_entry (신규 등록):** **summary=가맹·장소**, **detail_memo=메뉴·품목** (+끼니면 \`…, 점심\`). **\`date\`**: 오늘/어제/**삼일·N일 전** 등 **상대일은 "오늘" 기준으로 직접 YYYY-MM-DD** — **이걸로 되묻지 말 것**. 캘린더 \`"오늘" "어제"\` **문구**는 메모·적요 **금지**. \`need_account_clarify: true\` 이면 **첫째 줄** \`fact_line\` **우선**, **둘째 줄** 결제수단. 금액/날짜(해석 불가)/summary 없으면 **도구 금지**.
**add_ledger_entry의 category 파라미터** — 아래 **고정 Enum만** (옛 원장 키워드는 참고용):
- EXPENSE: ${ADD_LEDGER_EXPENSE_CATEGORIES.join(', ')}
- INCOME: ${ADD_LEDGER_INCOME_CATEGORIES.join(', ')}
[매핑] Enum 문자열 **정확히 하나**. 임의 신규 문구 금지. 끝까지 애매하면 '기타 지출' / '기타 수입'.`,
      }
    : null

  try {
    let routedIntent = 'chat'
    let intentOverrideMessage = null

    // 1) 지기방 전용: LLM intent-router → create_entry만 Structured 게이트
    if (tailMessage?.role === 'user' && latestUserText) {
      const route = await runIntentRouter(apiKey, latestUserText)
      routedIntent = route.intent || 'chat'
      intentOverrideMessage = buildIntentOverrideSystemMessage(routedIntent, latestUserText)
      if (route.intent === 'create_entry') {
        const structured = await runStructuredEntryParser(apiKey, latestUserText, dbContext)
        // 기록 의도로 라우팅된 턴은 반드시 "도구 호출 또는 누락 질문"으로만 종료한다.
        if (!structured || structured?.is_financial_data !== true) {
          return json(200, {
            type: 'reply',
            text: '거래 기록 요청으로 이해했어요. 금액·적요·날짜(오늘/어제 가능)와 결제수단(카드/현금/통장)을 알려 주세요.',
          })
        }
        if (structured.is_complete !== true) {
          return json(200, {
            type: 'reply',
            text:
              String(structured.cfo_message || '').trim() ||
              '거래 기록을 위해 누락된 정보를 알려 주세요.',
          })
        }
        const call = buildAddLedgerToolCallFromStructured(structured)
        return json(200, {
          type: 'tool_call',
          assistantMessage: {
            role: 'assistant',
            content: null,
            tool_calls: [call],
          },
          calls: [call],
        })
      }
    }

    // 2) 일반 대화/조회/수정/삭제/분석/시각화는 기존 tool-agent 루프
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          ...(contextMessage ? [contextMessage] : []),
          ...(intentOverrideMessage ? [intentOverrideMessage] : []),
          ...messagesForOpenAI,
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return json(response.status, { error: `OpenAI 오류: ${errText}` })
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    if (!choice) {
      return json(500, { error: 'OpenAI 응답에 선택지가 없습니다.' })
    }

    // GPT가 도구 호출을 원하는 경우
    if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length) {
      return json(200, {
        type: 'tool_call',
        assistantMessage: choice.message,
        calls: choice.message.tool_calls,
      })
    }

    // 최종 텍스트 응답
    return json(200, {
      type: 'reply',
      text: choice.message?.content || '답변을 생성하지 못했습니다.',
    })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' })
  }
}
