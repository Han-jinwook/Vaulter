# 📖 [금고키퍼] 핵심 기능 명세 및 AI 역할 정의서 (Canonical)

> **[🎯 현재 최우선 타깃 스프린트]** 제3방(예산) `BudgetPage`와 로컬 DB(원장)의 **실시간 연동** 및 **`isConsumptiveLedgerExpense` 완벽 적용** (월 한도 `budgetSettings` ↔ 지기 소비).  
> ※ **[착시 타파] CFO** — **반영됨** (`chat-assistant-budget.js` 시스템 프롬프트 + 클라 `budgetContextForApi` → `BudgetChatPanel` body).

> **문서 지위:** 기획·코드 변경 시 **이 문서(§0~4)를 1차 기준**으로 삼는다.  
> **과거 기획(긴본):** `docs/plan-archive.md` (2026-04-15 캡처)  
> **합의 반영:** 2026-04-21 (재미니) · 2026-04-22 (스프린트/아카이브) · 2026-04-26 (CFO `budgetContext`/착시 타파 연동) · 2026-04-28 (지기: `fact_line`/상대일·끼니 `detail_memo`) · **코드 대조:** 아래 [구현 대조](#구현-대조-코드-베이스-스냅샷)

---

## §0. 시스템 코어 철학 및 아키텍처

**프로덕트 미션:** "카드 사용은 빚이다." 유저의 현금흐름 **착시**를 부수고, **팩트** 중심으로 소비를 돕는 **개인 AI CFO**에 가깝다.

**기술 스택(저장/연동):**

- PWA + 브라우저 **로컬** 저장소(IndexedDB + Zustand)를 **메인**으로 사용.
- **웹훅** 등 외부 푸시는 **Netlify Functions**와 **Blobs(비동기 큐)** → 클라이언트가 **Pull(동기화)** 하는 **2단** 구조(서버는 IndexedDB에 직접 접근하지 않음).

---

## §1. 제1방: 지기 (Keeper) — 일일 장부·현금흐름

**역할:** 일상 거래(수입/지출)를 **1차** 수집·분류·기록.

**기능**

- **자연어/텍스트 파싱:** 채팅·SMS 류를 AI가 분석해 **표준 필드**(date, title, amount, category, type)로 **원장(ledger_lines)**에 반영.
- **웹훅 자동화:** iOS 단축어/안드 **POST** → 큐(Blobs) 적재 → **앱 진입·visibility** 시 **Pull**·머지.

**AI 규칙**

- **[팩트 폭격]:** 결제 수단이 **신용카드**이면, 기록 직후 **"다음에 갚을 단기 외상(빚)이 OOO 늘었다"** 류 **경고 멘트**를 **반드시** (과장 없이 사실·숫자 기준).
- **[할부 수수료 분리]:** 청구에 **이자·할부 수수료**가 있으면 **원금(상환)** 과 분리, **이자/금융수수료**(소비)로 **별도** 기록.

---

## §2. 제2방: 황금자산 (PB) — 대차·부채

**역할:** 자산/부채·순자 **팩트**를 등록·추적 (지기 원장과 **별** 황금자산 라인).

**기능·스키마**

- 자산/부채 **라인** 관리(금액·as-of 등).
- **부채**는 **2종만:** **카드 대금**(생활 밀착 **단기**), **대출**(유이자 **장기**).
- **대시보드:** **🚨 갚아야 할 카드 빚** / **남은 대출금** 을 **자극적·짧게** 노출(등록 합계 기반).

**AI 규칙**

- **[빚 청산 브리핑]:** "카드값 냄·대출 갚음" → 일상 **지출**이 아니라 **부채 잔액 감소**로 **`update_asset_item`**. 이후 **냉정·팩트** 한두 문장(남은 빚 OOO).

---

## §3. 제3방: 예산 & 목표 (CFO) — 통제

**역할:** 월간 예산·장기 목표 **페이스** (지기와 **역할 분리**).

**기능**

- (목표) **지기에서 소비가 나갈 때** **[카테고리별] 잔여 예산**을 **실시간** 반영(원장+소비성 필터).
- **소비성 필터:** 앱 전역 `isConsumptiveLedgerExpense` — **카드대금 결제**·**대출 상환** 은 **소비/예산 통계**에서 **제외**.

**AI 규칙**

- **[착시 타파]:** 통장에 돈이 있어 보여도, **신용/예산 기준**으로 한도 위면 **지체 없이** 경고.

---

## §4. 제4방: 비밀금고 (Vault) — 대량·보안

**역할:** 월말 **대량**·**비정형**·보안 **증빙** (실시간 지기와 **역할 분리**).

**기능**

- (선택) **Gmail** 에서 **카드 명세** 류 **주기** 수집·파싱.
- **Bulk import:** CSV/엑셀 **다건** → 원장.
- **멀티모달:** 영수증 이미지 → Vision **정제** → 지기.

**AI 규칙:** 비정형(HTML, 표, 이미지)에서 **핵심 결제**만 **추출**하는 **가공자** 역할.

---

## 구현 대조 (코드 베이스 스냅샷)

| 구역 | 명세 핵심 | 구현 | 비고 |
|------|-----------|------|------|
| **§0** | IDB+Zustand, 웹훅 2단 | ✅ `vaultStore`, Netlify `webhook-*`, `registerAndSyncWebhookInbox` | 로컬 순수 Vite는 Blobs 503 — `netlify dev`/배포에서 전체 동작 |
| **§1** | 파싱, 웹훅, 팩트·수수료 | ✅ `chat-assistant.js`, `webhook-receipt`, 프롬프트, Enum(이자/상환) | `ledger_lines` + `ingestWebhookInboxItems` · **§1 지기 채팅 · 원장 팔로우업** 참고(모델 `gpt-4o-mini`, `fact_line` 등) |
| **§2** | 부채 2종, UI, 청산 AI | ✅ `goldenAssetCategories`, `chat-assistant-assets.js`, `AssetsPage` | 구 라벨은 `normalize` |
| **§3** | 실시간 예산·`isConsumptive` | **진행** | ✅ `BudgetPage`: `useAssetStats` 소비+`useThisMonthConsumptiveByCategory`+`budgetSettings(월한도, localStorage)` / 초과 시 경고. ▢ 카테고리별 **한도**·목표 DB는 다음 |
| **§3** | CFO AI [착시 타파] + 실시간 `budgetContext` | **✅** | `netlify/functions/chat-assistant-budget.js`(스냅샷·착시·폴백) · `src/lib/budgetContextForApi.ts` · `src/components/chat/BudgetChatPanel.jsx`(요청마다 payload) · `selectThisMonthConsumptiveExpenseTotal` |
| **§4** | Gmail·벌크·비전 | **부분** | 코드 경로 있음, E2E는 별도 점검 |

---

## §1 지기 채팅 · 원장 팔로우업

(상단 **합의 반영** 2026-04-28 전후, 코드·프롬프트에 반영된 §1 보완)

- **모델:** 지기(금고) 채팅 `/.netlify/functions/chat-assistant` — **`gpt-4o-mini`** (OpenAI Chat Completions).
- **계정 미지정:** `add_ledger_entry` 후 `need_account_clarify` — 클라 `AIChatPanel`이 **`fact_line`**(YYYY-MM-DD, 적요, 메모, ₩, 카테고리)을 내려주고, 답은 **팩트 한 줄 → 결제(현금/카드) 질문** 위주(수치 없는 추상 "확인" 멘트 금지).
- **날짜:** "삼일 전"·"N일 전" 등 **상대·구어**는 **요청 기준 "오늘"**에서 YYYY-MM-DD로 **직접 환산** — 같은 뜻으로 **캘린더를 다시 묻지 않음**.
- **메모 `detail_memo`:** "점심으로/저녁에" 등은 **끼니(식사 맥락)** — 예: **`보리밥, 점심`**, **`돼지갈비, 저녁`** (쉼표). 캘린더 말(오늘/어제)은 메모에 넣지 않음(날짜 열과 중복).

---

## (보관) 이전 통합 기획

> 풀텍스트: **`docs/plan-archive.md`** (커밋 `c489999` 시점 `plan.md` 백업, UTF-8)  
> 추가 열람: `git log --oneline -- plan.md` · `git show <commit>:plan.md`

이 문서 **§0~4**가 **핵심 제품·AI 명세**이고, `plan-archive`는 **히스토리/스티치·로드맵** 참고용이다.
