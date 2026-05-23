# AI규칙.md (코드 기준 Canonical)

**일시:** 2026-05-07 (KST) — 다른 세션에서 열람 시 **본 일시와 저장소 최신 커밋을 함께** 확인할 것.

이 문서는 `plan.md`의 제품 방향을 **현재 레포에 실제 구현된 동작**으로 정리한 운영 기준서다.  
프롬프트·툴·클라이언트 로직을 바꿀 때 **코드와 이 문서를 세트로** 갱신한다.

---

## 0) 공통 운영 규칙

- **모델/호출**
  - 지기 서버 함수 `netlify/functions/chat-assistant.js`: Structured 게이트·intent-router·항목 후보 단발 호출 등 **`gpt-4o-mini`** (Chat Completions).
  - API 키: `OPENAI_API_KEY`(환경변수 우선, 로컬 `.env` 폴백).
- **응답 원칙**
  - 한국어, 간결, 수치 기반.
  - 도구로 확인 가능한 요청은 **tool 우선 호출 후 답변**.
  - 금액 표기 `₩` + 천 단위 쉼표.
- **방 간 이동**
  - 전담 도메인이 아닐 때만 `[ACTION_LINK:...]` 사용.
  - **지기(Keeper)** 는 원장 조회/추가/수정/삭제를 지기 안에서 처리하고, 지기로 보내는 이동 링크를 출력하지 않음.

---

## 1) 지기(Keeper) 규칙

### 1-1. 역할

- 원장 거래 조회·추가·수정·삭제·분석·시각화 전담.
- 삭제 요청은 지기에서 즉시 처리(타 방 전가 금지).

### 1-2. 라우팅·Structured 게이트

- 매 사용자 턴마다 **LLM intent-router(JSON)** (`runIntentRouter`):  
  `create_entry | delete | query | update | analyze | visualize | chat`
- **`create_entry`** 일 때만 **Structured Output** 경로 (`runStructuredEntryParser`).
- Structured 결과:
  - `is_financial_data=false` → 일반 대화/툴 루프.
  - `is_financial_data=true` 이고 필수 누락 → `is_complete=false`, `missing_fields`, `cfo_message`.
  - 필수가 채워지면 `is_complete=true` → `add_ledger_entry` 툴 호출 응답.

### 1-3. 채팅 「항목」이중층 — 표시 풀 vs Keeper 저장 Enum vs 원장 UI 표시

| 층 | 위치 | 역할 |
|----|------|------|
| **표시 풀** | `chat-assistant.js` `CHAT_DISPLAY_EXPENSE_POOL`(38), `CHAT_DISPLAY_INCOME_POOL`(7) | 채팅 칩·Structured 후보 문자열 **전부 이 목록 안**만 허용. 외부 리서치 정본 순서 유지. |
| **저장 Enum** | Keeper `add_ledger_entry` 지출 10종·수입 4종 | 툴·원장 내부 집계용 (`ADD_LEDGER_*`). |
| **표시 문자열 보존** | `src/types/schema.ts` `categoryDisplay?`, `vaultStore.resolveStoredCategoryFromUserInput` | 사용자가 고른 **38+7 라벨**이 Enum과 다를 때(예: 생활용품 → 쇼핑/뷰티) **`category`는 Enum**, **`categoryDisplay`는 사용자 라벨**. 원장 표·필터·Sankey는 `categoryDisplay ?? category`. |

- 클라이언트 매핑: `vaultStore.ts`의 `CHAT_DISPLAY_TO_KEEPER_EXPENSE` / `CHAT_DISPLAY_TO_KEEPER_INCOME`, `normalizeKeeperAddLedgerCategory`.
- 거래별 키워드 하드코딩 금지 원칙 유지 — 표시 풀·히스토리·의미 LLM·안전 쌍만 사용.

#### 지출 38 · 수입 7 정본 목록 (`chat-assistant.js` 배열 순서와 동일)

**지출 (38):** 식재료/마트, 외식, 카페/간식, 편의점, 배달, 주거비, 관리비, 공과금, 통신, 교통, 온라인쇼핑, 생활용품, 병원, 교육, 패션/잡화, 약국, 대중교통, 택시, 주유, 주차/통행, 차량정비, 문화/여가, 영화/공연, 운동/헬스, 미용/뷰티, 여행, 숙박, 술/담배, 세탁, 도서/학습, 보험, 구독, 세금, 대출이자, 경조사, 반려동물, 해외결제, 멤버십  

**수입 (7):** 급여, 사업/부수입, 이자, 배당, 지원금/연금, 용돈/이전, 환급/캐시백  

### 1-4. `ensureCategoryCandidates` — 항목 후보 보정 (카테고리만 비었을 때)

**호출 조건:** Structured 결과에서 `onlyCategoryMissing`(분류만 없고 적요·금액·날짜 있음)이면 HTTP 응답 `type: 'category_confirm'` 전 **`ensureCategoryCandidates`** 실행.

**중요:** 구조화 1차의 `category_candidates`는 신뢰하지 않음. **`structuredForEnsure = { ...structured, category_candidates: [] }`** 로 넘겨 항상 히스토리·의미 LLM 경로를 태운다(오추천 칩 고착 방지).

**3단계 (기계적 배열 앞 2개 슬라이스 폴백 없음 — 제거됨):**

1. **Step 1 — 히스토리:** `dbContext.categoryHistoryHints`(클라 `AIChatPanel`이 원장 확정 건 요약 전달). 적요·메모·사용자 원문과 slug/부분 포함으로 점수 매겨 후보 채움.
2. **Step 2 — 의미 LLM:** 부족 시 `gpt-4o-mini`, `temperature: 0.1`, `response_format: json_object`. 프롬프트에서 철물점·생필 소매류는 교육·운동보다 생활/쇼핑 계열 우선 등 **의미 지침** 포함. 최대 **2회** 시도.
3. **Step 3 — 안전 쌍:** 여전히 2개 미만이면 풀 내 고정만 사용 — 지출 `['생활용품','온라인쇼핑']`, 수입 `['급여','환급/캐시백']`. (`SAFE_CATEGORY_PAIR_*`)

**클라 칩 순서:** `buildCategoryOptionsForPendingEntry`는 **`suggestedCategories`(서버) 먼저**, 그다음 히스토리 매칭 — 저장 직후 같은 가맹점 히스토리가 앞으로 오며 칩 순서가 뒤집히는 현상 완화.

### 1-5. 지기방 채팅 UX (항목·계정 확정 후 압축)

- 메시지 타입 `pending_entry_category` (`vaultStore` `ChatType`).
- 계정까지 확정 시 **새 텍스트 말풍선 추가하지 않음**: `updateChatMessage(id, { resolved: true, pendingFooterLine: '항목 · 계정' })`.
- 같은 블록에 **날짜·적요·금액 한 줄 + 확정 한 줄**만 표시. 칩·입력 그리드는 숨김.
- `account_confirm` 확정 후에도 동일하게 **`pendingFooterLine`** 으로 압축 표시 (`completeTransactionReview` / `confirmTransactionAccount`에서 설정).
- 대화 연속성: 확정 후 `conversationRef`에 사용자·assistant 한 줄씩 푸시.

### 1-6. add_ledger_entry 규칙

- 호출 조건: Structured `is_complete=true`.
- 날짜 상대표현은 요청 시점 기준 YYYY-MM-DD.
- 카테고리는 Keeper 고정 Enum만.
- `summary` 가맹/장소, `detail_memo` 품목·끼니 등.

### 1-7. 계정 확인 UX

- `missing_fields`에 `account` 또는 `need_account_clarify`: 첫 줄 `fact_line`, 둘째 줄 계정 질문.
- 추상 확인 멘트 금지. 수입은 결제수단 표현 남용 금지.

### 1-8. 조회/삭제/분석 도구

- `delete/query/update/analyze/visualize`는 Structured 등록 게이트 없이 기존 tool-agent 루프.
- `query_ledger`: 기간·분류·계정·가맹·`location`(출처). fuzzy 정규화·짧은 오타 허용.
- 대화 트리밍 시 `assistant(tool_calls)`와 `tool` 짝 유지.
- `analyze_category_spending`, `render_visualization` 등 기존 명세 유지.

### 1-9. 클라이언트·원장 표시 연동 요약

| 파일 | 내용 |
|------|------|
| `AIChatPanel.jsx` | `categoryHistoryHints`, `category_confirm` → `pending_entry_category`, `handlePendingEntryCategory`, 압축 UI |
| `vaultStore.ts` | `resolveStoredCategoryFromUserInput`, `categoryDisplay`, `updateChatMessage`, `ChatMessage.pendingFooterLine` |
| `TransactionTable.jsx` | `ledgerVisibleCategory`, 항목 편집 시 `resolveStoredCategoryFromUserInput` |
| `VaultSankeyCard.jsx` | `categoryDisplay \|\| category` |

### 1-10. 지기 특화 반영(과거~현재 유지)

- 구글 시트 구조화 파싱: `결제수단`→`account`, 메모→`userMemo`, `reasoning`을 메모로 쓰지 않음.
- 자동 확정: 계정 구체적이면 CONFIRMED, 모호하면 PENDING.

---

## 2) 황금자산(PB)

- 자산/부채 라인 CRUD (`add_asset_item` 등).
- 카테고리 Enum: 투자 자산, 부동산/보증금, 보험/연금, 기타 자산 / 카드 대금, 대출.
- 일상 원장 요청은 `defer_to_keeper`. 카드값·대출 상환은 부채 업데이트.

---

## 3) 예산&목표(CFO)

- `budgetContext`, 착시 타파, `isConsumptiveLedgerExpense`와 연동.
- 수치 없으면 추정 금지.

---

## 4) 비밀금고(Vault)

- 문서 등록·열람. 원장 기록은 금고에서 처리하지 않음.

---

## 5) 유지보수 체크리스트

- 표시 풀(38+7) 변경 시 **`chat-assistant.js` 배열 + `vaultStore` 매핑 + 본 문서 목록** 동시 수정.
- `ensureCategoryCandidates` 변경 시 Step 1~3·`structuredForEnsure`·안전 쌍 문서화.
- `categoryDisplay` 도입 후 원장·차트·채팅 힌트 중 한쪽만 옛 `category`만 쓰는지 grep 점검.
- 검증 스모크: 철물점류 의미 후보, 확정 후 말풍선 압축, 원장 칩에 사용자 라벨 표시.
