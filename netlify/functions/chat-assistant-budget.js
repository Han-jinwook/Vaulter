import fs from 'node:fs'
import path from 'node:path'
import { interRoomSystemSuffix } from './interRoomSystemSuffix.js'

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

function buildBudgetCfoSystemPrompt() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  return `당신은 사용자의 거시적인 현금흐름을 분석하고 꿈(목표)을 향한 로드맵을 그려주는 '여유롭고 냉철한 개인 CFO(재무이사)'다.
오늘(기준일): ${dateStr} / 이번 달(월): ${yearMonth}

【역할】
- 일일 잔소리꾼이나 미시적 가계부 감독자가 **아니다**. **월 단위** 예산·수지·목표 궤도를 다루는 **거시** 관점이 핵심이다.

【행동 지침 1: 미시적 통제 금지】
- 사용자가 **단건 지출**만 말해도 과민 반응·호들갑·훈계하지 마라. 데이터가 전부 입력되지 않았을 수 있다.
- 단건 지출만으로 "예산을 잘 지키고 있다" "목표에 가까워졌다"는 식의 **섣부른 판단·확정적 결론을 절대 내리지 마라**. 필요하면 "월 결산이 갖춰지면 그때 수치로 보겠다"는 태도를 유지해라.

【행동 지침 2: 월 단위 결산 유도】
- 대화의 포커스는 **일 단위**가 아니라 **월 단위 결산**이다. 사용자가 가계·정리·마감에 대해 말할 기미가 있으면, **부드럽게** 예를 들어
  "이번 달 결산 자료 정리가 다 끝나셨나요? 정리가 완료되면 목표·예산 대비 이번 달 수지 타산을 분석해 드리겠습니다"
  를 **푸시**해도 좋다(강압·질책 금지).

【행동 지침 3: 거시적 분석 및 목표 연계】
- **월 결산이 갖춰진 것**으로 **합리적으로** 판단될 때에만(또는 앱/컨텍스트에 월 수지 요약이 있을 때) 전체 예산 대비 **초과·절약**을 **보수적**으로 해석해라.
- 예) "이번 달 [카테고리/여유] 덕에 [하와이 가족여행] 목표 달성률이 대략 X%p 개선될 수 있습니다" 처럼 **큰 그림**에서 조언(단, 수치·문맥이 없으면 지어내지 마라).
- \`add_goal_item\` 은 **목표·금액·일자**가 확보될 때 **등록 기록**용으로 쓰며, **클라이언트 스텁**이므로 DB가 아님. 호출 뒤에는 **다음 제안(월 점검, 재조정)** 을 **차분**하게.

【톤】
- 여유·냉철·간결. 금액은 ₩와 천 단위 쉼표. **한국어**만.
${interRoomSystemSuffix()}`
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_goal_item',
      description:
        '재무 목표 한 건을 앱에 등록 기록으로 남긴다(클라이언트·스텁 수신, DB는 추후). 제목·목표 금액·목표일이 정해지면 호출해도 좋다.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '목표명' },
          target_amount: { type: 'number', description: '목표 금액(원)' },
          target_date: { type: 'string', description: '목표일 YYYY-MM-DD' },
          current_amount: {
            type: 'number',
            description: '현재 모인 금액(원). 생략 시 0',
          },
        },
        required: ['title', 'target_amount', 'target_date'],
      },
    },
  },
]

const MAX_HISTORY_MESSAGES = 20

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  return messages.slice(-MAX_HISTORY_MESSAGES)
}

function buildBudgetContextBlock(budgetContext) {
  if (!budgetContext || typeof budgetContext !== 'object') {
    return '【예산/목표 컨텍스트】 (앱에서 아직 별도 요약이 없음 — 대화로 파악하고 add_goal_item 으로 기록해도 됨.)'
  }
  const keys = Object.keys(budgetContext)
  if (keys.length === 0) {
    return '【예산/목표 컨텍스트】 (비어 있음 — 대화에서 목표를 이끌어내고 add_goal_item 으로 정리해도 됨.)'
  }
  try {
    return `【예산/목표 컨텍스트(클라이언트)]\n${JSON.stringify(budgetContext, null, 0).slice(0, 2000)}`
  } catch {
    return '【예산/목표 컨텍스트】 (요약을 읽을 수 없음 — 대화 기준으로 진행.)'
  }
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

  const { messages, assistantType, budgetContext } = body
  if (assistantType !== 'budget') {
    return json(400, { error: 'assistantType은 budget 이어야 합니다.' })
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages 배열이 필요합니다.' })
  }

  const trimmedMessages = trimHistory(messages)
  const contextMessage = { role: 'system', content: buildBudgetContextBlock(budgetContext) }

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
          { role: 'system', content: buildBudgetCfoSystemPrompt() },
          contextMessage,
          ...trimmedMessages,
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.28,
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

    if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls?.length) {
      return json(200, {
        type: 'tool_call',
        assistantMessage: choice.message,
        calls: choice.message.tool_calls,
      })
    }

    return json(200, {
      type: 'reply',
      text: choice.message?.content || '답변을 생성하지 못했습니다.',
    })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' })
  }
}
