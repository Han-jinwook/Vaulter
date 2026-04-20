import fs from 'node:fs'
import path from 'node:path'

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
오늘 날짜: ${dateStr} (${yearMonth}). 기간 추론 시 이 날짜를 절대 기준으로 삼아라.
"이번 달" = ${yearMonth}, "지난 달" = ${prevYearMonth}.

【핵심 행동 규칙】
1. 거래 내역 조회·수정 요청에는 반드시 도구(function)를 먼저 호출하고, 실제 데이터를 확인한 뒤 답변해라.
2. 절대로 데이터를 지어내거나 추측하지 마라.
3. query_ledger 실행 후 개별 거래 내역이나 중간 계산 과정을 채팅창에 나열하지 마라.
   → 반드시 아래 형식으로만 답변해라:
   "N월 [카테고리/검색어] 내역은 총 X건이며, 합계는 ₩YYY입니다. 상세 내역은 왼쪽 원장 화면에 표시해두었습니다."
4. 통계·분석 질문("제일 많이 쓴 카테고리", "카테고리별 요약", "합계" 등)에는 query_ledger가 아니라 반드시 analyze_category_spending을 호출해라.
   → 연산 결과는 클라이언트가 이미 계산해서 넘겨주므로, GPT는 절대 직접 수학 계산을 하지 마라.
   → tool 결과의 topCategory, topAmount를 그대로 읽어 단 한 줄로 브리핑해라.
   예) "가장 지출이 큰 카테고리는 식비로, 총 ₩69,000입니다. 상세 내역은 왼쪽 원장에 표시해두었습니다."
5. 결과가 0건이면 tool 결과의 _db.categories 목록을 참고해 비슷한 카테고리를 제안해라.
6. analyze_category_spending 결과를 받아 topCategory가 있으면, 답변 끝에 반드시 다음 태그를 붙여라 (렌더링 안 됨):
   [WINNER_CATEGORY:카테고리명]
   예) "가장 많이 쓴 카테고리는 식비입니다. [WINNER_CATEGORY:식비]"
7. 말투는 전문적이고 간결하게. 한국어로만 답변해라.
8. 금액은 반드시 ₩ 기호와 천 단위 구분 쉼표를 사용해라.`
}

// ─── Tool 스키마 ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_ledger',
      description:
        '원장(가계부)에서 거래 내역을 검색합니다. 기간·카테고리·가맹점으로 필터링할 수 있습니다.',
      parameters: {
        type: 'object',
        properties: {
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
            description: '카테고리 필터 (부분일치). 예: 식비, 교통',
          },
          excludeCategories: {
            type: 'array',
            items: { type: 'string' },
            description: '제외할 카테고리 목록. 예: ["쇼핑","구독"] → 해당 카테고리 거래를 결과에서 제외',
          },
          account: {
            type: 'string',
            description: '계정(결제수단) 필터 (부분일치). 시스템 메시지의 "등록된 계정 목록"에서 골라 사용해라.',
          },
          merchant: {
            type: 'string',
            description: '가맹점 이름 검색어 (부분일치). 예: 스타벅스',
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
      name: 'update_ledger',
      description: '특정 거래의 카테고리를 수정합니다.',
      parameters: {
        type: 'object',
        properties: {
          txId: {
            type: 'string',
            description: '수정할 거래의 ID (query_ledger 결과의 id 필드)',
          },
          category: {
            type: 'string',
            description: '새로운 카테고리명. 예: 식비',
          },
        },
        required: ['txId', 'category'],
      },
    },
  },
]

// ─── 대화 길이 제한 (토큰 절약) ──────────────────────────────────────────────
const MAX_HISTORY_MESSAGES = 20

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  // 항상 첫 user 메시지 유지 + 최근 N개
  return messages.slice(-MAX_HISTORY_MESSAGES)
}

// ─── 핸들러 ───────────────────────────────────────────────────────────────────
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

  // 유저 원장 현황을 별도 시스템 메시지로 주입 (매 요청마다 최신 상태 반영)
  const contextMessage = dbContext
    ? {
        role: 'system',
        content: `【현재 유저의 원장 데이터 현황】
- 등록된 계정(결제수단) 목록: ${dbContext.accounts?.length ? dbContext.accounts.join(', ') : '없음'}
- 등록된 카테고리 목록: ${dbContext.categories?.length ? dbContext.categories.join(', ') : '없음'}
- 총 거래 건수: ${dbContext.totalTransactions ?? 0}건
- 기간: ${dbContext.dateRange ?? '없음'}

query_ledger 호출 시 위 목록에 있는 계정·카테고리 이름을 그대로 사용해라.
유저가 "현금"이라고 하면 계정 목록에서 일치하는 항목을 찾아 account 파라미터로 전달해라.
유저가 "식비"라고 하면 카테고리 목록에서 일치하는 항목을 찾아 category 파라미터로 전달해라.`,
      }
    : null

  try {
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
          ...trimmedMessages,
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
