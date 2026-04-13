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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return json(503, { error: 'OPENAI_API_KEY is not configured' })
  }

  let requestBody
  try {
    requestBody = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const imageBase64 = String(requestBody.imageBase64 || '')
  const mimeType = String(requestBody.mimeType || 'image/jpeg')
  if (!imageBase64) {
    return json(400, { error: 'imageBase64 is required' })
  }

  const systemPrompt = [
    '너는 대한민국 최고의 재무/회계 분류 전문가야.',
    '첨부된 영수증/문서 이미지를 분석해서 구조화된 데이터를 추출해.',
    '부가세나 테이블 번호 같은 잡정보는 무시하고, 실제 결제처(merchant), 결제일(date: YYYY-MM-DD), 고객이 지불한 총액(amount: 숫자), 가장 적합한 지출 카테고리(category), 그리고 분류 사유(reasoning)를 파악해.',
    '반드시 JSON 형식으로만 응답해.',
    '{"merchant":"","date":"YYYY-MM-DD","amount":0,"category":"","reasoning":"","confidence":0.0}',
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
          { type: 'text', text: '이미지를 분석해 JSON으로만 답변해 주세요.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
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

    return json(200, { ok: true, data })
  } catch (error) {
    return json(500, {
      error: 'analyze-receipt exception',
      detail: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

