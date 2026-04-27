import crypto from 'node:crypto'
import {
  CORS,
  addLedgerCategoryEnumBlock,
  initBlobsContext,
  getBlobStore,
  json,
  loadOpenAiKey,
  safeParseJSON,
  parseUserIdToken,
  assertAuthPair,
} from './webhookCommon.js'

function todayIsoDate() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildWebhookParsePrompt() {
  const d = todayIsoDate()
  return `너는 가계부 영수증 한 줄을 구조화하는 변환기다. 입력은 결제/입금에 대한 임의의 한국어·숫자 텍스트다.
${addLedgerCategoryEnumBlock()}

규칙:
- **출력은 JSON 오브젝트 하나뿐** (설명·Markdown·코드펜스 금지)
- **필드:** type(문자열 "EXPENSE" 또는 "INCOME"), category(위 Enum), amount(양의 숫자, KRW), date(YYYY-MM-DD), title(짧은 한글 메모, 가맹점·용도)
- "오늘"이면 date="${d}" 로 두어라. 날짜를 도저히 알 수 없을 때만 "${d}".
- 금액이 여러 개면 **가장 합리적인 총액(결제·출금) 1개**를 택해라.
- 수입(급여·환급·이자·입금)이면 type=INCOME, 지출이면 type=EXPENSE.`
}

const EXPENSE_CATEGORY_ENUM = [
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

const INCOME_CATEGORY_ENUM = ['급여', '부수입', '금융 수입', '기타 수입']

function inferExpenseCategoryFromTitle(title) {
  const t = String(title || '').toLowerCase()
  if (!t) return ''
  if (
    /(식당|분식|국밥|밀면|냉면|칼국수|김밥|치킨|피자|버거|카페|커피|베이커리|빵집|도시락|족발|보쌈|해장국|떡볶이|편의점|맥도날드|버거킹|롯데리아|스타벅스|투썸|본죽|본도시락)/i.test(
      t
    )
  ) {
    return '식비'
  }
  if (/(택시|버스|지하철|주차|톨게이트|기름|주유|충전소|카카오택시|대리운전)/i.test(t)) {
    return '교통/차량'
  }
  if (/(쿠팡|11번가|지마켓|올리브영|무신사|화장품|쇼핑|옷|의류|신발)/i.test(t)) {
    return '쇼핑/뷰티'
  }
  if (/(월세|관리비|통신|요금|전기|가스|수도|인터넷|휴대폰)/i.test(t)) {
    return '주거/통신'
  }
  if (/(영화|넷플릭스|유튜브|티빙|게임|공연|여가|도서|책)/i.test(t)) {
    return '문화/여가'
  }
  if (/(병원|약국|치과|한의원|의원|진료|검사|약값)/i.test(t)) {
    return '건강/병원'
  }
  if (/(수수료|이자|연체|리볼빙)/i.test(t)) {
    return '이자/금융수수료'
  }
  if (/(카드대금|카드값|청구대금)/i.test(t)) {
    return '카드대금 결제'
  }
  if (/(대출 상환|원리금|대출금)/i.test(t)) {
    return '대출 상환'
  }
  return ''
}

function normalizeParsedCategory(type, rawCategory, title) {
  const category = String(rawCategory || '').trim()
  if (type === 'INCOME') {
    if (INCOME_CATEGORY_ENUM.includes(category)) return category
    const t = `${category} ${title}`.toLowerCase()
    if (/(급여|월급|연봉)/i.test(t)) return '급여'
    if (/(이자|배당|예금)/i.test(t)) return '금융 수입'
    if (/(환급|리워드|중고판매|용돈|수익|수입)/i.test(t)) return '부수입'
    return '기타 수입'
  }
  if (EXPENSE_CATEGORY_ENUM.includes(category)) return category
  return inferExpenseCategoryFromTitle(title) || '기타 지출'
}

function safeParseRequestBody(event) {
  if (!event?.body) return { text: '' }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : String(event.body)
  const o = safeParseJSON(raw)
  if (o && typeof o === 'object' && typeof o.text === 'string') {
    return { text: o.text }
  }
  if (typeof raw === 'string' && raw.trim()) {
    return { text: raw.trim() }
  }
  return { text: '' }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' })
  }
  if (!initBlobsContext(event)) {
    return json(503, { ok: false, error: 'BLOBS_CONTEXT_UNAVAILABLE' })
  }
  const parsedQs = parseUserIdToken(event)
  if (!parsedQs.ok) {
    return json(400, { ok: false, error: parsedQs.error })
  }
  const { userId, token } = parsedQs
  const store = getBlobStore()
  const auth = await assertAuthPair(store, userId, token)
  if (!auth.ok) {
    return json(auth.status, { ok: false, error: auth.error })
  }
  const { text } = safeParseRequestBody(event)
  if (!String(text).trim()) {
    return json(400, { ok: false, error: 'EMPTY_TEXT' })
  }
  const apiKey = loadOpenAiKey()
  if (!apiKey) {
    return json(500, { ok: false, error: 'OPENAI_NOT_CONFIGURED' })
  }
  const body = {
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildWebhookParsePrompt() },
      { role: 'user', content: String(text).slice(0, 8000) },
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
  if (!res.ok) {
    const t = await res.text()
    return json(502, { ok: false, error: 'OPENAI_ERROR', detail: t.slice(0, 200) })
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  const parsed = safeParseJSON(String(content || ''))
  if (!parsed || typeof parsed !== 'object') {
    return json(422, { ok: false, error: 'PARSE_FAILED' })
  }
  const type = String(parsed.type || '').toUpperCase() === 'INCOME' ? 'INCOME' : 'EXPENSE'
  const amount = Math.abs(Number(parsed.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return json(422, { ok: false, error: 'INVALID_AMOUNT' })
  }
  const title = String(parsed.title || '웹훅 영수증').trim() || '웹훅 영수증'
  const category = normalizeParsedCategory(type, parsed.category, title)
  const idPart = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
  const key = `q/${userId}/${idPart}.json`
  const record = {
    v: 1,
    createdAt: new Date().toISOString(),
    key,
    parsed: {
      type,
      category,
      amount,
      date: String(parsed.date || todayIsoDate()).trim(),
      title: title.length > 200 ? title.slice(0, 200) : title,
    },
    rawText: String(text).slice(0, 12000),
  }
  await store.set(key, JSON.stringify(record), { metadata: { userId, kind: 'receipt' } })
  return json(200, { ok: true, id: idPart, key })
}
