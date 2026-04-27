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

function addLedgerCategoryEnumBlock() {
  return `【add_ledger_entry — 카테고리 고정 Enum(반드시 이 명칭만)】
- type=EXPENSE(지출)일 때 **category** 는 다음 중 **정확히 하나**만: ${ADD_LEDGER_EXPENSE_CATEGORIES.join(', ')}
- type=INCOME(수입)일 때 **category** 는 다음 중 **정확히 하나**만: ${ADD_LEDGER_INCOME_CATEGORIES.join(', ')}
[카테고리 매핑 룰] 가계부에 새로 등록할 때 유저의 지출/수입 내용을 해석해 **위 지정 분류 중 한 가지**로만 택해라. **절대** 임의의 카테고리 문구를 새로 만들지 마라. 애매하거나 끼는 분류가 없으면 type에 맞게 **'기타 지출'** 또는 **'기타 수입'**을 써라.
- **이자/금융수수료** = 할부 이자, 리볼빙·연체료, 카드 수수료 등 **빚을 줄이는 돈이 아닌** 비용(예산·소비에 탄다).
- **카드대금 결제** / **대출 상환** = 통장에서 나가 **부채를 갚는** 납부(빌린 원금/청구액). 일상 "쇼핑" 지출이 아님(앱이 예산·소비 통계에서 별도 처리).
(참고) query_ledger·기존 원장에 나온 옛 카테고리명은 **조회·필터**에 쓰일 뿐이며, **add_ledger_entry 로 새로 쌓는 건** 항상 위 Enum만 쓴다.`

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
- **가맹점명 기반 추론 강화:** 상호가 `식당/분식/국밥/밀면/냉면/칼국수/김밥/치킨/피자/버거/카페/커피/베이커리/본죽/본도시락` 류이거나 `~본점`, `~점` 형태의 **음식점 맥락**이면 기본을 **식비**로 둔다. 예: `두레밀면본점`, `홍콩반점`, `OO국밥`.
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
1. **조회·수정·분석·시각화** 요청(위 등록 케이스가 아닐 때)에는 반드시 도구(function)를 먼저 호출하고, 실제 데이터를 확인한 뒤 답변해라. 등록 의도인데 **[필수 4요소]가** 미비하면(스마트 추론으로도 못 채울 때) 규칙 1을 **적용하지 말고** add_ledger_entry·다른 tool 호출을 하지 않는다.
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
7. 말투는 **짧고 직관**. 상단 **【채팅 답변 — 짧고 직관】** 우선. 한국어로만 답변해라.
8. 금액은 반드시 ₩ 기호와 천 단위 구분 쉼표를 사용해라.
9. 유저가 "자금 흐름도", "흐름도", "차트", "시각화", "Sankey" 등을 요청하면 반드시 render_visualization을 호출해라.
${interRoomSystemSuffix()}`
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
- 등록된 카테고리 목록(기존 원장에 쌓인 **과거/혼재** 분류, 조회·필터용): ${dbContext.categories?.length ? dbContext.categories.join(', ') : '없음'}
- 총 거래 건수: ${dbContext.totalTransactions ?? 0}건
- 기간: ${dbContext.dateRange ?? '없음'}

query_ledger 호출 시 위에 있는 **계정·(기존)카테고리**를 검색/필터에 활용해도 좋다.
유저가 "현금"이라고 하면 계정 목록에서 일치하는 항목을 찾아 account 파라미터로 전달해라.
유저가 기존 원장 키워드로 "식비" 등을 말하면 category 필터는 위 목록과 맞출 수 있다.

**add_ledger_entry (신규 등록):** **summary=가맹·장소**, **detail_memo=메뉴·품목** (+끼니면 \`…, 점심\`). **\`date\`**: 오늘/어제/**삼일·N일 전** 등 **상대일은 "오늘" 기준으로 직접 YYYY-MM-DD** — **이걸로 되묻지 말 것**. 캘린더 \`"오늘" "어제"\` **문구**는 메모·적요 **금지**. \`need_account_clarify: true\` 이면 **첫째 줄** \`fact_line\` **우선**, **둘째 줄** 결제수단. 금액/날짜(해석 불가)/summary 없으면 **도구 금지**.
**add_ledger_entry의 category 파라미터** — 아래 **고정 Enum만** (옛 원장 키워드는 참고용):
- EXPENSE: ${ADD_LEDGER_EXPENSE_CATEGORIES.join(', ')}
- INCOME: ${ADD_LEDGER_INCOME_CATEGORIES.join(', ')}
[매핑] Enum 문자열 **정확히 하나**. 임의 신규 문구 금지. 끝까지 애매하면 '기타 지출' / '기타 수입'.`,
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
