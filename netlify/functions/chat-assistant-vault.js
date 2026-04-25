import fs from 'node:fs'
import path from 'node:path'
import { interRoomSystemSuffix } from './interRoomSystemSuffix.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const VAULT_DOC_CATEGORIES = ['계약서', '증명서', '영수증/보증서', '고지서', '기타 문서']

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

function buildVaultArchivistSystemPrompt() {
  const now = new Date()
  const dateStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  })
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`

  return `당신은 과묵하고 충직한 보안 집사(아키비스트)다. 사용자의 비밀금고(원본·증빙 문서)를 다루는 **전담** 비서다.
오늘(기준일): ${dateStr} / 앱이 문서 \`date\` 필드에 쓰는 **오늘(YYYY-MM-DD)**: ${todayYmd}

【역할】
- 톤은 **차분·간결·신뢰**. 불필요한 수다·감정 표현을 줄인다. 한국어만.

【문서 열람 — UI 트리거(핵심)】
- 사용자가 "이 문서 열어줘", "◯◯ 계약서 보여줘" 등 **열람** 의도이면, 채팅에 세부(보증금·만기·계좌 등)를 **길게 나열하지 마라.**
- 반드시 \`open_vault_document\` 를 호출해 **좌측 메인(원본 뷰) + 하단 요약 패널**이 열리게 할 **UI 트리거**만 수행한다. (도구 \`summary_for_panel\` 에 한 줄~몇 문장 요약만, 예: 보증금, 만기일)
- 열람이 아닌 "등록"이면 add_vault_document 쪽.

【문서 등록 add_vault_document】
- \`add_vault_document\` 는 \`date\`·\`title\`·\`target\`·\`expiry_date\`·\`category\`·\`memo\` 스키마를 **정확히** 채운다.
- \`date\` 는 입력·등록 기준일로 **YYYY-MM-DD**; 유저가 안 주면 **${todayYmd}** (오늘)을 써도 된다.
- \`category\` 는 반드시 다음 중 하나: ${VAULT_DOC_CATEGORIES.map((c) => `"${c}"`).join(', ')}.
- \`expiry_date\` 가 없으면 \`null\` (JSON null).
- **능동적 역질문:** \`memo\` 가 사실상 비어 있거나(한두 단어) 부실하면, 도구를 호출하기 **전** 또는 **호출 직전**에 짧게 물어라. 예: "특약 사항이나 계좌번호도 메모해 둘까요?" (압박·잔소리 금지)

【★ 금고 방이 하지 말 것】
- 일상 **지출/원장 기록**, 자산/부채 CRUD, 월간 예산 결산은 **다른 방**이 담당. 해당 발화는 아래 [방 간 이동] 룰을 따르며 **임의로 금고 도구에 넣지 마라.**

【도구】
- add_vault_document, open_vault_document 만 사용(본 프롬프트 범위). 미등록 id로 open 하면, 요청만 반영하도록 \`open_vault_document\` 를 보내고 클라이언트가 처리.
${interRoomSystemSuffix()}`
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_vault_document',
      description: '비밀금고에 문서 메타 1건을 등록한다(클라이언트 수신, Phase 1 로컬).',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: `입력일 YYYY-MM-DD(시스템이 오늘로 채울 수 있음. 미입력 시 앱이 오늘 날짜로 보정)`,
          },
          title: { type: 'string', description: '문서 제목' },
          target: { type: 'string', description: '대상/가맹점(기관, 계약 상대방 등)' },
          expiry_date: {
            type: 'string',
            description: '만료/갱신 YYYY-MM-DD. 없으면 빈 문자열(앱에서 null 처리)',
          },
          category: {
            type: 'string',
            enum: VAULT_DOC_CATEGORIES,
            description: '문서 분류(고정 enum)',
          },
          memo: { type: 'string', description: '상세 메모' },
        },
        required: ['title', 'target', 'category', 'memo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_vault_document',
      description:
        '문서를 열람할 때: 채팅에 장문 나열 금지. 좌측·하단 UI를 열기 위한 트리거. document_id는 앱이 부여한 id(또는 제목 힌트로 클라이언트가 해석).',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string', description: '문서 id(없으면 title_hint로 찾기)' },
          title_hint: { type: 'string', description: 'id 없을 때 제목/키워드' },
          summary_for_panel: {
            type: 'string',
            description: '하단 요약 패널(짧게: 보증금, 만기 등)',
          },
        },
        required: ['summary_for_panel'],
      },
    },
  },
]

const MAX_HISTORY_MESSAGES = 20

function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  return messages.slice(-MAX_HISTORY_MESSAGES)
}

function buildVaultContextBlock(vaultContext) {
  if (!vaultContext || typeof vaultContext !== 'object') {
    return '【금고 컨텍스트】 (요약 없음 — 문서 id는 도구/등록에 따름)'
  }
  try {
    return `【금고 컨텍스트(클라이언트)】\n${JSON.stringify(vaultContext, null, 0).slice(0, 2000)}`
  } catch {
    return '【금고 컨텍스트】 (파싱 불가)'
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

  const { messages, assistantType, vaultContext } = body
  if (assistantType !== 'vault') {
    return json(400, { error: 'assistantType은 vault 이어야 합니다.' })
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages 배열이 필요합니다.' })
  }

  const trimmedMessages = trimHistory(messages)
  const contextMessage = { role: 'system', content: buildVaultContextBlock(vaultContext) }

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
          { role: 'system', content: buildVaultArchivistSystemPrompt() },
          contextMessage,
          ...trimmedMessages,
        ],
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.22,
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
      text: choice.message?.content || '말씀을 잠시 정리하겠습니다.',
    })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : '서버 오류가 발생했습니다.' })
  }
}
