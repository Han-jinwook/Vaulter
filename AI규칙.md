# AI규칙.md (코드 기준 Canonical)

이 문서는 `plan.md`의 제품 방향을, **현재 실제 코드에 박힌 AI 동작 규칙**으로 재정리한 운영 기준서다.  
프롬프트/툴/클라이언트 로직을 변경할 때 이 문서를 먼저 갱신한다.

---

## 0) 공통 운영 규칙

- **모델/호출**
  - 서버 함수의 LLM은 현재 전부 `gpt-4o-mini`(OpenAI Chat Completions) 사용.
  - API 키는 `OPENAI_API_KEY`(환경변수 우선, 로컬 `.env` 폴백).
- **응답 원칙**
  - 한국어, 간결, 수치 기반.
  - 도구로 확인 가능한 요청은 **tool 우선 호출 후 답변**.
  - 금액 표기는 `₩` + 천 단위 쉼표.
- **방 간 이동**
  - 전담 도메인이 아닐 때만 `[ACTION_LINK:...]` 사용.
  - 단, **지기(Keeper) 함수는 지기 전용 suffix 사용**: 원장 작업(조회/추가/수정/삭제)은 지기에서 직접 처리하고, 지기로 이동시키는 링크를 출력하지 않음.

---

## 1) 지기(Keeper) 규칙

### 1-1. 역할

- 원장(가계부) 거래의 조회/추가/수정/삭제/분석/시각화를 전담.
- 삭제 요청은 지기에서 즉시 처리(타 방 전가 금지).

### 1-2. 입력/기록 대원칙 (5필드)

- **필수 4**: 분류(카테고리), 적요(summary), 계정(account), 금액
- **선택 1**: 메모(detail_memo / memo)
- 메모는 있으면 기록, 없다고 추가 질문 강요하지 않음.
- 서버(`chat-assistant.js`)는 user 입력 턴마다 **LLM intent-router(JSON)** 를 먼저 실행한다:
  - intent enum: `create_entry | delete | query | update | analyze | visualize | chat`
  - `create_entry`일 때만 Structured Output 게이트로 진입
  - router 실패/파싱 실패 시 안전하게 `chat`으로 복귀(기존 루프 유지)
  - delete/query/update/analyze/visualize intent는 메인 프롬프트 전에 **intent override 시스템 메시지**를 주입해 해당 툴 선호를 강제한다.
- Structured Output 게이트(`create_entry` 전용):
  - `is_financial_data=false`면 일반 대화/조회 흐름으로 보낸다.
  - `is_financial_data=true`인데 필수4 누락이면 `is_complete=false` + `missing_fields`로 되묻는다.
  - 필수4가 갖춰졌을 때만 `is_complete=true`로 등록 단계(`add_ledger_entry`)로 진입한다.

### 1-3. add_ledger_entry 규칙

- 호출 조건: Structured 게이트 결과 `is_complete=true`일 때만 호출.
- 날짜는 상대 표현(오늘/어제/삼일 전/N일 전 등)을 요청 시점 기준으로 YYYY-MM-DD 환산.
- 카테고리는 고정 Enum만 허용:
  - 지출: 식비, 교통/차량, 쇼핑/뷰티, 주거/통신, 문화/여가, 건강/병원, 이자/금융수수료, 카드대금 결제, 대출 상환, 기타 지출
  - 수입: 급여, 부수입, 금융 수입, 기타 수입
- `summary`는 가맹/장소 우선, `detail_memo`는 메뉴/품목/끼니 태그(`품목, 점심`) 우선.
- Structured 게이트 응답 스키마 기준:
  - `is_financial_data`, `is_complete`, `missing_fields`, `extracted_data`, `cfo_message`
  - `extracted_data.category`는 Enum 값만 허용(아니면 누락으로 처리)
  - JSON 파싱 실패/형식 불량은 안전 fallback 후 되묻기 우선(무리한 자동등록 금지)

### 1-4. 계정 확인 UX 규칙

- Structured 게이트에서 `missing_fields`에 `account`가 있으면 DB 반영 없이 즉시 질문한다.
- `need_account_clarify`이면:
  - 첫 줄: `fact_line`(YYYY-MM-DD, 적요, 메모(있으면), ₩금액, 카테고리)
  - 둘째 줄: 계정 확인 질문
- 추상형 문구(“확인되었습니다”) 금지.
- 수입 질문에서 “결제수단” 표현 남용 금지(입금/수취 계정 중심 질문).
- 모호 계정(예: `은행이체`, `계좌이체`)은 구체 계정명이 확인될 때까지 `PENDING`/질문 대상으로 본다.

### 1-5. 조회/삭제/분석 도구 규칙

- `delete/query/update/analyze/visualize` intent는 Structured 등록 게이트를 거치지 않고 기존 tool-agent 루프에서 처리한다.
- 특히 `delete` intent는 `query_ledger -> delete_ledger(반복)` 순서를 우선 강제하고, 출처 힌트(샘플/시트/가져오기)는 `location` 필터 활용을 우선한다.
- `query_ledger`: 기간/분류/계정/가맹 + `location`(가져오기 출처) 필터 지원.
  - 텍스트 매칭은 **범용 정규화**(NFKC, 소문자, 문장부호 제거) + 포함 비교를 사용한다.
  - `location`/`category`/`account`/`merchant` 전부 동일한 fuzzy 매칭 유틸을 써서 공백·`_`·`-`·`:`·기호 차이를 흡수한다.
  - 짧은 오타는 1글자 편집거리 허용(길이 제한)으로 보정한다.
  - UI는 검색 결과 제목을 중복 노출하지 않고, 상단 배너 1회 + `전체 보기` 버튼으로 필터 해제를 명확히 안내한다.
- `delete_ledger`: 1건 삭제 도구. 다건 삭제는 `query_ledger`로 id 목록 확보 후 반복 호출.
- `analyze_category_spending`: 카테고리 합산/순위 질문 전담(직접 계산 금지).
- `render_visualization`: 시각화 요청 시 필수 호출.

### 1-6. 지기 특화 반영(최근)

- 구글 시트 가져오기:
  - CSV 구조화 파싱 우선(열 스코어 기반), 실패 시 AI 청크 분석.
  - `결제수단` 열은 `account`, `메모/비고` 열은 `memo`로 분리 저장.
  - `reasoning` 디버그 문자열을 `userMemo`로 쓰지 않음.
- 자동 확정 정책:
  - 계정이 구체적이면 `CONFIRMED` 우선.
  - 계정이 비어있거나 `은행이체/계좌이체`처럼 모호하면 `PENDING` + 최소 질문.
  - 다건 반영 시 질문 건수 최소화(확정 가능한 건은 묻지 않음).

---

## 2) 황금자산(PB) 규칙

### 2-1. 역할

- 자산/부채 라인 CRUD 전담 (`add_asset_item`, `update_asset_item`, `delete_asset_item`).

### 2-2. 카테고리 Enum

- ASSET: 투자 자산, 부동산/보증금, 보험/연금, 기타 자산
- DEBT: 카드 대금, 대출

### 2-3. 핵심 동작

- 자산/부채 총액·순자 질의는 `assetContext.systemInfo`를 우선 참조.
- 일상 소비성 요청(식비/커피/원장 기록 등)만 `defer_to_keeper`로 지기 이동.
- “카드값 냄/대출 상환”은 일상지출이 아니라 부채 잔액 업데이트(`update_asset_item`)로 처리.
- 기준일(date) 필수(없으면 오늘).

---

## 3) 예산&목표(CFO) 규칙

### 3-1. 역할

- 월 단위 예산/목표/페이스 관리(거시 관점).

### 3-2. 데이터 기준

- `budgetContext`의 실시간 스냅샷(월한도/누적/남은한도/isOverBudget/isBudgetDangerLow)을 최우선 사용.
- 수치 없으면 추정 금지.

### 3-3. 착시 타파 규칙

- `isOverBudget=true`면 잔고가 있어도 한도 초과 사실을 명확히 경고.
- `isBudgetDangerLow=true`면 선제 경고(과소비 직전).
- 단건 지출만으로 섣부른 결론/훈계 금지(단, 착시 타파 조건은 예외 우선).

### 3-4. 도구

- `add_goal_item`(목표 기록용). 현재 클라이언트 수신 중심(영구 DB 아님).

---

## 4) 비밀금고(Vault) 규칙

### 4-1. 역할

- 문서/증빙의 등록·열람 전담(보안 아카이브 톤).

### 4-2. 등록 규칙 (`add_vault_document`)

- 필드: `date`, `title`, `target`, `expiry_date`, `category`, `memo`
- `category` Enum: 계약서, 증명서, 영수증/보증서, 고지서, 기타 문서
- `expiry_date` 없으면 null 처리.
- 메모가 빈약하면 짧게 보강 질문 후 등록.

### 4-3. 열람 규칙 (`open_vault_document`)

- 열람 요청 시 채팅 장문 설명 금지.
- UI 트리거 중심(좌측 원본/하단 요약 패널 오픈).

### 4-4. 금지

- 원장 거래 기록/삭제, 자산부채, 예산 결산 업무를 금고에서 처리하지 않음(필요 시 해당 방 이동).

---

## 5) 유지보수 체크리스트 (프롬프트 수정 시)

- 룰을 케이스별 땜질이 아니라 **슬롯/의사결정 순서**로 기술했는지
- tool 스키마와 프롬프트 설명이 서로 모순 없는지
- 지기 삭제/다건 처리에서 라우팅 오동작이 재발하지 않는지
- 시트 구조화 파싱(수입/지출/계정/메모)과 대화 UX(질문 최소화)가 일치하는지
- 변경 후 최소 검증:
  - 지기: 추가/조회/다건삭제/location 필터
  - 지기: 계정 확정/모호계정 질문
  - 자산: 일상 소비 defer, 부채 업데이트
  - 예산: over/danger 문구 분기
  - 금고: 등록/열람 트리거 분기

