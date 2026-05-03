# 2026-05-03 리셋 인계 — 지기방 거래 생성 항목 후보 UI

> **작성 일시:** 2026-05-03 22:03 KST  
> **현재 기준 커밋:** `0204565` (`fix(chat): 항목 후보 생성을 프롬프트 원칙으로 이동`)  
> **직전 커밋:** `14f3a73` (`fix(chat): 항목 후보 2개 보강`)  
> **사용자 결론:** 현재 세션에서 해결 실패. 다음 세션에서 원점 재검토 필요.

---

## 1. 현재 사용자가 보고 있는 실제 문제

채팅에서 사용자가 새 거래를 입력:

```text
막내 축구클럽 월회비 10만원 송금함
```

현재 화면 결과:

- AI 응답 말풍선은 `2026-05-03, 막내 축구클럽, 월회비 송금함, ₩100,000.` 형태로 나옴.
- 안내 문구는 `항목을 선택하거나 직접 입력해 주세요.`로 바뀌었음.
- 아래 입력 UI는 2줄 구조로 나옴.
  - 1줄: `항목 직접 입력` 입력창
  - 2줄: `계정 선택` 드롭다운, `새 계정명 입력`, `확인`
- **문제:** 항목 추천 칩 2개가 없음.
- 사용자가 원하는 화면:
  - 1줄: 항목 추천 칩 2개 + 항목 직접 입력
  - 2줄: 계정 선택 + 새 계정명 입력 + 확인

즉, 레이아웃은 어느 정도 맞았지만 **항목 후보 생성/전달이 실패** 중이다.

---

## 2. 사용자가 강하게 요구한 원칙

사용자는 “축구/월회비 → 건강체육비/학원비” 같은 케이스를 코드에 하드코딩하는 방식을 원하지 않는다.

요구 원칙:

1. **먼저 DB/기존 거래 히스토리에서 유사 적요·메모·상호의 항목을 찾는다.**
2. 매칭되는 기존 항목이 있으면 그 항목을 우선 추천한다.
3. 기존 히스토리가 없으면 AI가 거래 의미를 해석해서 범용 항목 후보 중 가장 가까운 2개를 추천한다.
4. 클라이언트에 거래별 키워드 룰을 하드코딩하지 않는다.
5. UI 용어는 `카테고리`가 아니라 **`항목`** 이다.
6. 항목 추천 칩과 계정 입력은 항상 별도 줄이다.

사용자 표현:

```text
하드코딩해놓은거 아니지?
AI에게 프롬프트 원론을 주입해야하는거야
```

---

## 3. 최근 수정 내역과 현재 상태

### `6167f45`

`pending_entry_category` UI를 바꿔서 항목 보완 화면에서도 계정 입력 줄이 같이 나오게 했다.

- `handlePendingEntryCategory(entry, category, account)`로 account 인자 추가.
- 칩 선택 시 즉시 저장하지 않고 선택 상태만 바꾸도록 변경.
- `확인` 버튼에서 항목 + 계정을 함께 저장.
- 이로써 2줄 UI의 뼈대는 생김.

### `14f3a73`

항목 후보가 비면 클라이언트에서 후보 2개를 보강하려고 했다.

- `COMMON_CATEGORY_CANDIDATES_FOR_CHAT`
- `CATEGORY_INFERENCE_RULES_FOR_CHAT`
- `pickFallbackCategoryOptions`

문제:

- `축구`, `월회비` 같은 키워드를 클라이언트에 직접 넣은 형태라 사용자가 반대함.

### `0204565`

위 클라이언트 하드코딩 룰을 제거했다.

- `AIChatPanel.jsx`에서 `CATEGORY_INFERENCE_RULES_FOR_CHAT`, `COMMON_CATEGORY_CANDIDATES_FOR_CHAT`, `pickFallbackCategoryOptions` 제거.
- `netlify/functions/chat-assistant.js` 프롬프트에 아래 원칙 추가:
  - 기존 히스토리 우선.
  - 히스토리 없으면 거래 의미를 해석해서 범용 후보 풀에서 가까운 항목 2개.
  - `category=null`일 때 `category_candidates`는 빈 배열이면 안 됨.
  - `기타`, `기타 지출`, `기타 수입` 금지.

그러나 사용자 스크린샷 기준으로 **아직 추천 칩 2개가 뜨지 않는다.**

---

## 4. 핵심 파일

- `src/components/chat/AIChatPanel.jsx`
  - `buildCategoryOptionsForPendingEntry`
  - `msg.type === 'pending_entry_category'`
  - `handlePendingEntryCategory`
  - `executeAiChat`에서 `data.type === 'category_confirm'` 처리

- `netlify/functions/chat-assistant.js`
  - `COMMON_CATEGORY_CANDIDATES`
  - `buildStructuredParseSystemPrompt`
  - `normalizeStructuredResult`
  - `runStructuredEntryParser`
  - `route.intent === 'create_entry'`에서 `type: 'category_confirm'` 반환하는 부분

---

## 5. 다음 세션에서 우선 확인할 것

### 5.1 서버가 실제로 `category_candidates`를 내려주는지 확인

현재 UI에 칩이 없다는 것은 대개 아래 중 하나다.

1. Netlify function 응답의 `entry.suggestedCategories`가 빈 배열이다.
2. 서버는 줬지만 클라이언트에서 `pendingEntry`에 전달되지 않았다.
3. `buildCategoryOptionsForPendingEntry`에서 필터링되었다.
4. 배포/로컬 런타임이 최신 커밋을 반영하지 않았다.

다음 세션은 먼저 `category_confirm` 응답 직전에 서버 로그 또는 임시 디버그로 아래를 확인해야 한다.

```js
structured.category_candidates
```

그리고 클라이언트에서 아래도 확인한다.

```js
data.entry.suggestedCategories
msg.pendingEntry.suggestedCategories
categoryOptions
```

### 5.2 프롬프트만으로 부족하면 “구조화 후처리”를 서버에서 해야 함

사용자는 클라이언트 하드코딩을 반대했지만, 서버가 AI 응답을 받은 뒤 `category_candidates`가 비어 있는 상태를 그대로 보내는 것도 UX 실패다.

권장 방향:

- 클라이언트에는 거래별 키워드 룰을 두지 않는다.
- 서버 프롬프트는 원칙을 강하게 둔다.
- 그래도 모델이 빈 후보를 주면 서버에서 **AI에게 재질문하거나**, 구조화 호출을 실패로 보고 `category_candidates` 2개가 나올 때까지 짧은 보정 호출을 한다.
- 이 보정도 케이스 하드코딩이 아니라 “아래 범용 후보 풀에서 의미적으로 가까운 2개만 JSON으로 골라라” 형태여야 한다.

예상 구현:

```js
async function ensureCategoryCandidates(apiKey, structured, dbContext) {
  // 1. structured.category_candidates가 2개면 그대로 반환
  // 2. 부족하면 별도 LLM 호출로 후보만 생성
  // 3. 그래도 실패하면 category_confirm를 보내지 말고 서버 측 오류/재질문 처리
}
```

중요:

- `축구`, `학원`, `병원` 같은 구체 키워드별 룰을 JS에 박지 말 것.
- 범용 후보 풀 자체는 프롬프트 어휘로 유지 가능.

### 5.3 `knownCategory` 처리 확인

현재 `normalizeStructuredResult`는 `category`가 알려진 항목이면 `is_complete=true`가 될 수 있다.  
그 경우 `category_confirm` UI 자체가 안 뜨고 바로 `add_ledger_entry`로 갈 수 있다.

이번 스크린샷은 `category_confirm` UI가 뜬 상태이므로 `category=null` 처리 자체는 된 것으로 보인다.  
하지만 `category_candidates`가 비어 있다.

---

## 6. 현재 코드상 의심 지점

`netlify/functions/chat-assistant.js`

```js
const categoryCandidates = Array.isArray(raw.category_candidates)
  ? raw.category_candidates
      .map((x) => String(x || '').trim())
      .filter((x) => x && !GENERIC_CATEGORY_SET.has(x))
      .slice(0, 2)
  : []
```

여기서 모델이 빈 배열을 주면 그대로 빈 배열이다.  
프롬프트에 “비우지 말라”고 해도 모델이 어기면 UI는 빈 칩으로 간다.

`src/components/chat/AIChatPanel.jsx`

```js
picked.forEach((opt) => addOption(opt.category))
suggested.forEach(addOption)
return options.slice(0, 2)
```

기존 거래 매칭도 없고 `suggested`도 비면 `[]`가 정상 반환된다.  
따라서 지금 보이는 현상과 일치한다.

---

## 7. 리셋 시 추천 작업 순서

1. `0204565` 기준에서 시작한다.
2. 같은 입력으로 실제 Netlify function 응답 JSON을 확인한다.
3. `category_candidates`가 빈 배열인지 확인한다.
4. 빈 배열이면 서버에서 후보 전용 보정 LLM 호출을 추가한다.
5. 클라이언트는 후보 표시만 담당하게 유지한다.
6. UI 문구는 계속 `항목`으로 유지한다.
7. 수정 후 `npm run build`.
8. 커밋/푸시하고 해시를 사용자에게 반드시 보여준다.

---

## 8. 커밋 참고

최근 관련 커밋:

```text
0204565 fix(chat): 항목 후보 생성을 프롬프트 원칙으로 이동
14f3a73 fix(chat): 항목 후보 2개 보강
6167f45 fix(chat): 항목 보완 UI를 2줄 입력으로 정리
1ed9bd4 fix(chat): 항목 추천을 DB 우선·범용 후보 추론으로 정리
736440a fix(chat): 기타 지출 고정 제거하고 항목 추천 선택 UX 복구
```

---

# Vaulter 지기(Keeper) AI — 문제 정리 & 외부 검토용 노트

> **문서 목적:** 채팅·원장 연동에서 반복되는 **엇박자(논리·숫자·필드 불일치)** 현상을 한곳에 묶어,  
> **프롬프트로 고칠 수 있는지 / 모델 교체로 나아지는지 / 제품·코드·외부 도움이 필요한지**를 구분한다.  
> **이 모델로 불가능한가?** 에 대한 답은 §6에 요약한다.

---

## 0. 메타

| 항목 | 내용 |
|------|------|
| **작성·리셋 일시** | 2026-04-29 (KST, Cursor 세션 기준) |
| **대상 범위** | 지기 탭 — `netlify/functions/chat-assistant.js`, `src/components/chat/AIChatPanel.jsx`, `runQueryLedger`, 원장 UI(`TransactionTable` 등), 로컬 원장 데이터 |
| **최신 코드 참고** | 본 문서는 특정 커밋 해시에 고정하지 않음. `main` 최신과 diff 비교 권장. |

---

## 1. 사용자에게 보이는 증상 (스크린샷·대화에서 확인된 패턴)

### 1.1 자연어가 “계정명”으로 저장·표시되는 현상

- 원장 행의 **계정** 칸이나 계정 필터에  
  **「가계부 샘플로 입력한 10건 삭제하자」** 같은 **채팅 한 줄 전체**가 들어가 있음.
- 결과:
  - 좌측 원장 **수동 필터** 줄에 `계정 가계부 샘플로…`처럼 **명령문이 필터 값처럼** 노출됨.
  - AI 답변 목록에도 **「계정: …삭제하자」** 형태로 **프롬프트/명령 잔재**가 거래 속성처럼 보임.

**성격:** 데이터 무결성 + (부수적으로) 모델이 `account`/`update_ledger`에 부적절한 문자열을 쓴 가능성.  
UI는 저장된 값을 **있는 그대로** 보여 줄 뿐이라, “AI가 필터를 엉뚱하게 읽었다”기보다 **잘못 들어간 필드**인 경우가 많음.

### 1.2 숫자·건수 불일치 (예: 10건 말하고 12건 삭제, 요약 7건인데 본문과 어긋남)

- 사용자 발화: “10건”
- 실제: 더 많은 `delete_ledger` 호출 또는 다른 id 집합.
- 또는: 요약은 “총 7건”인데, 목록 항목·내러티브와 **기대 집합이 다름**.

**성격:** (1) **도구 결과 미준수**(모델이 `count`/`id` 목록과 무관한 숫자를 자연어에 씀), (2) **집합 불일치**(질의 조건과 삭제 대상 id 불일치).

### 1.3 기간·필터와 무관해 보이는 조합 (예: 2026·2023 거래가 한 번에 나열)

- 사용자는 원장에서 **기간·유형·계정** 등으로 좁힌 상태일 수 있음.
- 채팅 답변에는 **여러 연도**가 한 블록에 섞여 보임 → “내가 고른 뷰와 같은 거 맞나?” 혼란.

**성격:** `query_ledger` 인자(기간 등)와 **실제 말하는 범위** 불일치, 또는 **원장 UI 상태가 API 컨텍스트에 없음**(아래 §4).

### 1.4 정책과 다른 출력 형태

- 시스템 규칙 상 **개별 거래 장문 나열을 채팅에 쓰지 말 것**인데, 사용자 스크린샷에는 **목록형 나열**이 등장하는 경우가 있음.

**성격:** 프롬프트 준수 실패 + 검증 레이어 부재.

### 1.5 “원장에 내가 선택한 내용 보여?”류 질문

- 사용자의 **현재 드롭다운·칩 상태**(기간, 계정, 항목, 유형, AI 필터)는 **기본적으로 OpenAI 요청 본문에 실려 가지 않음**.
- 모델은 **`dbContext`(계정 목록·카테고리·건수·날짜 범위 등)** 와 **도구 결과**로만 “선택”을 간접 추론 가능.

**성격:** 아키텍처상 **컨텍스트 공백**. 모델만 바꿔도 근본 해결 어려움.

---

## 2. 원인 분류 (기술적으로 무엇이 어긋나는가)

| 구분 | 설명 |
|------|------|
| **A. 데이터 오염** | 거래 `account` 등에 사용자 문장·명령이 저장됨 → 필터/요약/목록 어디에든 그대로 새어 나옴. |
| **B. 도구↔자연어 불일치** | `query_ledger`의 `count`/`allMatchingIds`와 답변 문장의 숫자·범위가 다름. |
| **C. UI 상태 미전달** | 원장에서 좁힌 필터가 챗 API에 없어 “선택된 뷰”와 답변이 어긋남. |
| **D. 스키마 오용** | `category`/`account`/`location`에 넣기 적합하지 않은 토큰(긴 문장, 삭제 의도 등)을 넣음. |
| **E. 출력 규율 미준수** | 나열 금지·건수만 말하기 등의 규칙을 어김. |

---

## 3. 이미 코드·프롬프트로 넣은 완화책 (참고용)

아래는 **완전 해결을 보장하지 않는 완화**이며, 재현 시 로그·도구 인자를 함께 봐야 함.

- **`query_ledger`**: 문장형 `account` 인자에 대한 **클라이언트 측 방어**(계정 fuzzy 매칭 생략·전체 하이라이트 완화 등) — `AIChatPanel.jsx` `runQueryLedger`.
- **삭제**: `delete_ledger` **즉시 삭제 제거**, **예/아니오 칩** 후 실행 — 엇박자 나도 실제 삭제 전에 한 번 더 막음.
- **프롬프트**: 삭제 시 **건수 정합**, `user_confirmation_pending` 의미, `query_ledger`만 진실 등 문구 보강 — `chat-assistant.js`.
- **원장 수동 필터 표시**: `기간`/`계정`/`항목` 접두 — 오해 감소.
- **입력창**: Enter 전송, Shift/Ctrl/Meta+Enter 줄바꿈 — 긴 지시문 입력 UX.

---

## 4. “프롬프트로 고쳐지나?” — 구분표

| 현상 | 프롬프트만으로 기대 가능한 정도 | 비고 |
|------|--------------------------------|------|
| 건수·합계를 **도구 결과와 동일하게** 말하기 | **중~상** | 반복 강조·위반 시 패널티 문구·예시 추가. 그래도 **검증 레이어**(サーバ or 클라이언트에서 숫자 재검) 없으면 재발. |
| category/account에 **짧은 토큰만** 넣기 | **중** | 스키마 설명·금지 예시(길이·공백 다수·삭제/청유 종결) 보강. |
| 채팅에 **거래 장문 나열 안 함** | **중** | 규칙 + 위반 시 후처리(응답 필터) 검토. |
| **이미 DB에 박힌 이상한 account** 제거 | **불가** | 마이그레이션·수동 수정·저장 시 검증 필요. |
| **원장에서 선택한 필터**와 답변 일치 | **불가(프롬프트만)** | 필터 상태를 `dbContext` 등으로 **명시 전달**하는 제품 변경 필요. |

---

## 5. “모델을 바꾸면 되나?”

- **도움이 되는 경우:** 지시 준수·툴 인자 안정성·추론이 약한 구형/저비용 모델에서 **더 강한 모델**로 바꾸면 **B, D, E** 유형이 줄 수 있음.
- **모델만으로 부족한 경우:**
  - **A** 오염 데이터는 그대로 남음.
  - **C** UI 상태 미전달은 **모델 교체와 무관**.
- 결론: **모델 교체 = 필요충분조건 아님.** 데이터·컨텍스트·검증 레이어와 함께 가져가야 함.

---

## 6. “이 모델로는 불가능한가?” — 짧은 답

- **불가능한 것:** “항상 100% 환각 없음”, “프롬프트만으로 DB 오염 자동 복구”, **사용자가 좁힌 UI 상태를 보지도 않고 항상 동일하게 추론**.
- **가능에 가까운 것:** **도구 결과를 단일 진실(Source of Truth)**로 두고, 자연어는 그에 **붙이는 요약만** 허용하거나, **서버/클라이언트에서 숫자·건수를 재계산해 덮어쓰기**(템플릿 응답).

즉, 목표를 **“모델이 실수 안 함”**이 아니라 **“실수해도 사용자에게 틀린 숫자가 안 나가게”**로 바꾸면 설계 난이도는 내려감.

---

## 7. 외부에 도움 요청 시 줄 체크리스트

외부 엔지니어·LLM 컨설팅·커뮤니티에 넘길 때 아래를 그대로 붙이면 좋음.

1. **스택:** Netlify Function OpenAI 호출 + **클라이언트에서 `query_ledger` 등 도구 실행** 후 결과를 다시 대화에 넣는 패턴.
2. **재현 패키지:** 문제가 된 **사용자 한국어 원문** 3~5개 + 해당 시점 **`query_ledger` 인자 JSON** + **`appliedFiltersEcho`** + (가능하면) 문제 거래 1행 스크린샷.
3. **원하는 계약:** “답변의 건수·합계 = 도구 `count`/`totalSumAbs`”를 **강제할 방법**(후처리 vs 스트리밍 금지 vs 구조화 출력 JSON).
4. **오픈 질문:** 원장 필터 상태를 **매 턴 `dbContext`에 넣는 설계**가 적당한지, 아니면 “선택 스냅샷 ID”만 넘길지.

---

## 8. 권장 다음 작업 (우선순위)

1. **`dbContext` 확장:** `ledgerPeriodPreset`, `ledgerAccountFilter`, `ledgerCategoryFilter`, `activeLedgerFilter`, (있으면) `aiFilter` 요약을 **매 요청**에 포함.
2. **쓰기 검증:** `update_ledger`·인라인 편집 저장 시 `account` 길이·패턴(예: 80자 초과·문장 종결 어미 다수) 경고 또는 거부.
3. **응답 검증(선택):** 최종 `reply` 전에 마지막 `query_ledger` 결과와 숫자 정합 스크립트(테스트용).
4. **데이터 클린업:** 이미 들어간 명백한 명령문 계정값 일괄 수정 도구(운영용).

---

## 9. 관련 파일 빠른 색인

| 영역 | 파일 |
|------|------|
| 시스템 프롬프트·툴 스키마 | `netlify/functions/chat-assistant.js` |
| 로컬 조회·삭제 실행·확인 칩 UI | `src/components/chat/AIChatPanel.jsx` |
| 원장 필터·표시 | `src/components/dashboard/TransactionTable.jsx` |
| 채팅 입력(줄바꿈) | `src/components/chat/IsolatedChatComposer.jsx` |
| 스토어·메시지 타입 | `src/stores/vaultStore.ts` |

---

*이 문서는 리셋본이며, 재현이 고정되면 “실제 로그 한 줄” 예시를 §1에 추가하는 것을 권장한다.*
