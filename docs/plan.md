# 금고키퍼(Vaulter) 핵심 기능 명세 및 AI 역할 정의서 (Canonical)

**일시:** 2026-05-07 (KST) — 문서 개정 기준일. 타 세션에서는 **`docs/AI규칙.md`와 함께** 읽고, 코드와 충돌 시 코드 우선.

> **[현재 최우선 타깃 스프린트]** 제3방 예산 `BudgetPage`와 로컬 원장의 실시간 연동 및 **`isConsumptiveLedgerExpense` 적용** (월 한도 ↔ 지기 소비). CFO 착시 타파는 `chat-assistant-budget.js` + `budgetContextForApi` + `BudgetChatPanel`에 반영됨.

**문서 지위**

| 문서 | 용도 |
|------|------|
| **`docs/plan.md` (본 문서)** | 제품 흐름·방(지기/자산/예산/금고)·아키텍처·구현 대조 표 |
| **`docs/AI규칙.md`** | AI·프롬프트·툴·채팅 항목 풀·클라 연동 **코드 기준 상세** |

**합의·구현 이력(요약):** 2026-04-21~28 (5필드·시트·fact_line·detail_memo) · **2026-05-07** (채팅 표시 풀 38+7, 의미 기반 항목 보정, **`categoryDisplay`**, 지기방 **압축 확정 UI**, 원장 표·필터·Sankey 연동) — 상세는 `AI규칙.md` §1.

---

## 현재 시점 토탈 스냅샷 (2026-05-07)

| 방 | 상태 | 한 줄 |
|----|------|--------|
| **§0 코어** | ✅ | PWA, IndexedDB + Zustand, 웹훅 → Netlify/Blobs → 클라 Pull |
| **§1 지기** | ✅+진행 | 원장·채팅·웹훅·Gmail·구조화 시트; **항목 표시 풀(38+7)**; **의미 LLM 후보 보정**; **저장 Enum + `categoryDisplay` UI층**; **확정 말풍선 압축** |
| **§2 황금자산** | ✅ | 자산/부채, `chat-assistant-assets` |
| **§3 예산·CFO** | ✅+진행 | `BudgetPage`, `isConsumptive`, CFO `budgetContext`; 카테고리별 한도 DB는 단계적 |
| **§4 금고** | 부분 | Gmail·비전·CSV/XLSX·Drive; E2E·프롬프트 정렬은 지속 |

**2026-05-07 코드 하이라이트 (지기·원장)**

- **서버** `netlify/functions/chat-assistant.js`: `ensureCategoryCandidates` — 히스토리 → LLM(`temperature 0.1`) → 안전 쌍; `category_confirm` 전 `category_candidates` 비운 복사본으로 재보정.
- **클라** `vaultStore.ts`: `resolveStoredCategoryFromUserInput`, `categoryDisplay`, `updateChatMessage`, 메시지 `pendingFooterLine`.
- **클라** `AIChatPanel.jsx`: `pending_entry_category` 확정 시 새 버블 없이 같은 메시지 접기; 히스토리 힌트에 `categoryDisplay` 우선 반영.
- **원장 UI** `TransactionTable.jsx`: `ledgerVisibleCategory`, 날짜 강조·체크박스–출처 간격·메모 타이포 조정 등.
- **대시보드** `AssetCard.jsx`: 업로드 버튼 상하 여백 미세 조정.

---

## §0. 시스템 코어

**미션:** 현금흐름 착시 완화, 팩트 중심 개인 CFO.

**저장:** 브라우저 로컬(IndexedDB + Zustand) 메인. 외부 푸시는 Netlify Functions + Blobs → 앱에서 Pull.

---

## §1. 지기(Keeper)

**역할:** 일상 수입·지출 1차 수집·분류·기록.

### 원장 필드 대원칙 (모든 입력 경로 목표 정렬)

| 구분 | 필드 | 비고 |
|------|------|------|
| 필수 4 | 분류·적요·계정·금액 | 채팅에서는 **표시 항목(38+7)** 과 **저장 Enum** 이 이중층 |
| 선택 1 | 메모 | 없어도 반복 질문하지 않음 |

- 시트 가져오기: 열 매핑으로 계정·메모 분리 → `documentParsers` / `buildPendingTxFromParsed`.
- **채팅 항목 UX:** 사용자가 고른 문자열은 가능하면 원장 칩에 그대로 보이게 `categoryDisplay` 보존(`AI규칙.md` §1-3 참고).

### 기능

- 자연어 파싱, 웹훅, Gmail, 시트 Drive CSV, 비전 영수증 등.

### AI·UX (지기방)

- 신용카드 팩트 멘트, 할부 이자 분리 등 기존 규칙 유지.
- **압축 UI:** 거래 확정 후 대화 스크롤 점유 최소화 — 별도 긴 확인 말풍선 없이 한 블록에 요약.

**상세 스펙:** `docs/AI규칙.md` §1.

---

## §2. 황금자산(PB)

자산/부채 라인. 카드값·대출 상환은 일상 지출이 아닌 부채 갱신.

---

## §3. 예산 & 목표(CFO)

월간 예산·페이스. `isConsumptiveLedgerExpense`로 카드대금·대출 상환은 소비 통계에서 제외. 착시 타파 문구는 `budgetContext` 기준.

---

## §4. 비밀금고(Vault)

문서·증빙 보관. 원장 CRUD는 지기 전담.

---

## 구현 대조 (코드 베이스 — 2026-05-07)

| 구역 | 명세 핵심 | 구현 파일(대표) |
|------|-----------|-----------------|
| §0 | IDB, 웹훅 | `vaultStore`, `netlify/functions/webhook-*`, `flushLocalVaultSnapshotToKv` |
| §1 | 파싱·채팅·항목 풀·표시층 | `chat-assistant.js`, `AIChatPanel.jsx`, `vaultStore.ts`, `TransactionTable.jsx`, `documentParsers.ts` |
| §1 | 항목 보정·무기계 폴백 | `ensureCategoryCandidates`, `SAFE_CATEGORY_PAIR_*`, `structuredForEnsure` |
| §1 | 표시→Enum→표시 보존 | `resolveStoredCategoryFromUserInput`, `CHAT_DISPLAY_TO_KEEPER_*`, `schema.ts` `categoryDisplay` |
| §2 | 자산 AI | `chat-assistant-assets.js`, `AssetsPage` |
| §3 | 예산·CFO | `chat-assistant-budget.js`, `budgetContextForApi.ts`, `BudgetChatPanel.jsx`, `BudgetPage` |
| §4 | Gmail·업로드·시트 | Gmail 동기, `FileUploadOverlay`, `parseGoogleSpreadsheetCsvForImport` 등 |

---

## §1 지기 채팅 · 원장 팔로우업 (요약)

- **엔드포인트:** `/.netlify/functions/chat-assistant` — 라우터 + Structured + (필요 시) 툴 루프.
- **항목 이중층:** 표시 풀 38+7 ↔ Keeper Enum ↔ 선택적 `categoryDisplay` (원장·Sankey·필터에서 사용자 라벨 우선 표시).
- **계정 미지정:** `account_confirm` 메시지·압축 확정 처리.
- **날짜:** 상대 표현은 서버 `today` 기준 YYYY-MM-DD. (캘린더 문구를 메모에 중복 넣지 않는 등 — `AI규칙` 참고)

---

## (보관) 이전 통합 기획

긴 기획 백업은 필요 시 별도 파일로 두면 된다. **`git log --oneline -- docs/plan.md`** 로 본 문서 이력 추적.
