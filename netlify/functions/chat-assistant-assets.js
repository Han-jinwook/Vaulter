import fs from 'node:fs'
import path from 'node:path'

const ASSET_CATEGORIES = ['투자 자산', '부동산/보증금', '보험/연금', '기타 자산']
const DEBT_CATEGORIES = ['대출', '개인 간 채무', '기타 부채']
const ALL_GOLDEN_CATEGORIES = [...ASSET_CATEGORIES, ...DEBT_CATEGORIES]

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

function buildSystemInfoBlock(systemInfo) {
  if (!systemInfo || typeof systemInfo !== 'object') {
    return '【System Info】 (클라이언트 집계 수치가 아직 전달되지 않음 — 가능하면 tools와 목록으로 답해라.)'
  }
  const t = (k) => {
    const n = systemInfo[k]
    return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ko-KR') : '—'
  }
  return `【System Info — 앱이 직접 집계한 최신 수치(자산/부채 질의 시 이 값을 기준으로 답해라)】
- 총 평가금액(누적 가용(지기 원장) + 등록 자산 합계 − 등록 부채 합계): ${t('totalNetWon')}원
- 누적 가용(지기 원장, 유동성·원장 잔): ${t('cumulativeLiquidityWon')}원
- 등록 자산 합계(ASSET 항목): ${t('sumRegisteredAssetsWon')}원
- 등록 부채 합계(DEBT 항목, 양수 합): ${t('sumRegisteredDebtsWon')}원
유저가 "내 자산 얼마", "총액", "순자", "부채", "포트폴리오"처럼 **재무/자산/부채 규모**를 묻는 경우 위 숫자로 정중히 브리핑한다. (도구로 계산을 새로 끌어오지 말고, 설명·요약이면 충분하다.)`
}

function buildAssetSystemPrompt() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })

  return `너는 VIP 자산·부채 관리 전담 비서다.
오늘: ${dateStr}

【역할】
- 유저 요청을 분석해 등록된 자산(ASSET)·부채(DEBT) 항목을 add_asset_item / update_asset_item / delete_asset_item 로 반영한다.
- 금액은 원(₩) 기준 숫자로 받는다. 한국어로 간결하게 답한다.

【지기로 보내지 말 것(본 탭이 담당)】
- "내 자산이/부채가/순자산이/총액/포트폴리오가 얼마"처럼 **자산·부채·총평가·순자**를 묻는 말: System Info(아래에 주입)와 목록을 바탕으로 답한다. defer_to_keeper 를 호출하지 **말라**.

【절대 하지 말 것 — 지기(Keeper)로만 쓰는 말(일상 소비)】
- **명백한** 일상 소비·싸구려 지출(식비, 커피, 점심, 마트, 국밥, 배달, 영수증, 가계부, 지기 **원장**·이번 달 쇼핑·카드 쓴 글 등)만 \`defer_to_keeper\` 를 쓴다.
- 아래 "일상"에 해당할 때만 다른 도구와 함께 호출하지 말고 defer_to_keeper 만 호출한다.
- defer_to_keeper 호출 후, 최종 답변은 반드시 아래 두 줄만 출력한다 (앞뒤로 다른 문장·도구·설명 금지):
고객님, 일상 지출 내역 관리는 [지기(Keeper)] 탭에서 도와드리고 있습니다. 이동하시겠습니까?
[CTA:keeper]

【자산 기준일 date (필수)】
- add_asset_item·update_asset_item 는 반드시 date(YYYY-MM-DD) 를 넣는다.
- 유저 발화의 "어제", "작년", "4월 10일" 등 취득·재평가·변동 **기준일**을 정확히 추론해 YYYY-MM-DD로 넣는다.
- 날짜를 **전혀** 말하지 않았다면 **오늘(한국어 프롬프트 상단 날짜에 해당하는 달력 날짜)** 을 쓴다. 시스템·임의의 타임스탬프에 의존하지 않는다.

【category (고정 enum만 사용)】
- 자산/부채 항목의 **category** 는 **아래 명칭 중 하나만** 쓴다(오탈자·띄어쓰기·축약·동의어·새 이름 금지).
- type=**ASSET** 일 때: "투자 자산" | "부동산/보증금" | "보험/연금" | "기타 자산"
- type=**DEBT** 일 때: "대출" | "개인 간 채무" | "기타 부채"
- 애매하면 **반드시** "기타 자산" 또는 "기타 부채"에 넣는다. **임의로 새 카테고리를 만들지 마라.**

【자산 도구 사용 규칙】
- id가 필요하면 assetContext에 나온 목록의 id를 그대로 사용한다.
- 금액은 양수로 전달한다. 부채는 type=DEBT로 구분한다.
- add_asset_item: 유저가 평단·담보·기간 등 보조 설명을 말하면 memo 파라미터에 담는다.
- 실행 후 사용자에게 한두 문장으로 무엇을 반영했는지만 말한다.`
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'defer_to_keeper',
      description:
        '**일상 소비(식비·커피·국밥·배달·쇼핑 결제·영수증·가계부/원장, 지기 연동 키워드)**일 때만 호출. "내 자산이/부채/총액/순자/포트폴리오가 얼마" 같은 **재무 질문**에는 절대 호출하지 말고 System Info로 답해라. CRUD(등록/수정/삭제)와 동시에 호출하지 마라.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: '내부용 요약 (유저에게 표시하지 않음)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_asset_item',
      description: '자산 또는 부채 한 줄을 등록한다.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['ASSET', 'DEBT'], description: 'ASSET=자산, DEBT=부채' },
          category: {
            type: 'string',
            enum: ALL_GOLDEN_CATEGORIES,
            description: 'type=ASSET: 앞 4개만. type=DEBT: 뒤 3개만(정확한 명칭).',
          },
          name: { type: 'string', description: '항목 이름' },
          amount: { type: 'number', description: '금액(원, 양수)' },
          date: {
            type: 'string',
            description: '취득·평가 기준일 YYYY-MM-DD (발화에서 추론, 없으면 오늘)',
          },
          memo: { type: 'string', description: '보조 설명(평단, 담보, 기간 등). 없으면 생략' },
        },
        required: ['type', 'category', 'name', 'amount', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_asset_item',
      description: '기존 자산/부채 한 줄을 수정한다.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'assetContext 목록의 id' },
          type: { type: 'string', enum: ['ASSET', 'DEBT'] },
          category: {
            type: 'string',
            enum: ALL_GOLDEN_CATEGORIES,
            description: '변경 시에도 위 enum만. type과 일치하는 쪽(자산 4/부채 3)을 고른다.',
          },
          name: { type: 'string' },
          amount: { type: 'number' },
          date: {
            type: 'string',
            description: '이번 변경이 반영되는 기준일 YYYY-MM-DD (재평가/수정 효력일, 없으면 오늘)',
          },
          memo: { type: 'string', description: '메모 변경(빈 문자열이면 메모 제거). 금액/메모 변경 시 히스토리에 누적' },
        },
        required: ['id', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_asset_item',
      description: '등록된 자산/부채 한 줄을 삭제한다.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'assetContext 목록의 id' },
        },
        required: ['id'],
      },
    },
  },
]

const MAX_HISTORY_MESSAGES = 20

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  return messages.slice(-MAX_HISTORY_MESSAGES)
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

  const { messages, assetContext } = body
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages 배열이 필요합니다.' })
  }

  const trimmedMessages = trimHistory(messages)

  const lines = Array.isArray(assetContext?.lines) ? assetContext.lines : []
  const linesSummary =
    lines.length === 0
      ? '(등록된 자산/부채 없음)'
      : lines
          .map(
            (l) => {
              const memo = l.memo ? ` | memo: ${l.memo}` : ''
              const d = l.asOfDate || ''
              return `- id=${l.id} | ${l.type} | ${l.category} | ${l.name} | ₩${Number(l.amount || 0).toLocaleString('ko-KR')}${d ? ` | asOf: ${d}` : ''}${memo}`
            },
          )
          .join('\n')

  const systemInfoText = buildSystemInfoBlock(assetContext?.systemInfo)

  const contextMessage = {
    role: 'system',
    content: `${systemInfoText}\n\n【현재 등록 자산·부채 목록 (id로 수정/삭제)】\n${linesSummary}`,
  }

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
          { role: 'system', content: buildAssetSystemPrompt() },
          contextMessage,
          ...trimmedMessages,
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
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
