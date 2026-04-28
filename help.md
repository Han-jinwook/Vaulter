# Vaulter 지기방 이슈 인수인계 (리셋본)

- 작성 일시: 2026-04-29 00:00 (KST)
- 목적: **다음 세션에서 바로 재현/수정 가능하도록 현재 문제를 초기화해서 정리**
- 범위: 지기방(`chat-assistant` + `AIChatPanel` + 원장 UI) 조회/삭제 정확도 및 UX 일관성

---

## 1) 지금 핵심 문제 요약

### 문제 A — 조회/삭제 문해력 회귀
- 사용자 질문이 분명한데, AI가 `query_ledger`에서 대상을 못 찾거나 엉뚱한 건을 잡는 케이스가 반복됨.
- 대표 증상:
  - “헬스장 얼마 사용했어?” → 헬스장 내역이 있는데도 “없다” 응답
  - “헬스장 이용권 있어?” → 같은 맥락인데도 못 찾는 응답
  - 삭제 요청 시도에서 검색 조건이 꼬여 0건 응답

### 문제 B — 소스/장소 의미 혼선
- 제목 아래 보조 텍스트가 `location` 기반이라, 사용자 입장에서는 “거래 장소인지/입력 출처인지”가 혼재됨.
- 특히 구글 시트만 `가계부-샘플`처럼 보여서 혼란을 유발.

### 문제 C — OpenAI tool-call 체인 오류 재발 가능성
- 과거 실제 에러:  
  `Invalid parameter: messages with role 'tool' must be a response to a preceding message with 'tool_calls'`
- 원인: 히스토리 트리밍 시 `assistant(tool_calls)`와 `tool` 짝이 깨짐.

---

## 2) 이번 세션에서 반영된 변경 사항

## 2-1. 서버(Netlify Function) 안정화
- 파일: `netlify/functions/chat-assistant.js`
- 반영:
  - `sanitizeToolCallHistory()` 추가
  - `trimHistory()`에서 고아 `tool` 메시지 제거
- 의도: OpenAI `invalid_request_error` 방지

## 2-2. 원장 리스트 보조 라인 정책 변경
- 파일: `src/components/dashboard/TransactionTable.jsx`
- 반영:
  - 제목 아래 보조 라인을 거래장소 대신 **소스 라벨**로 통일
  - 예시:
    - `manual` → `소스: 입력`
    - `upload` → `소스: 문서 · 파일명`
    - `gmail` → `소스: Gmail`
    - `webhook` → `소스: 연동`

## 2-3. 용어 정합성(프롬프트/툴 스키마) 개선
- 파일: `netlify/functions/chat-assistant.js`
- 반영:
  - `query_ledger`의 `location` 의미를 “소스 라벨”로 명시
  - 삭제 intent override 문구도 동일 의미로 통일

## 2-4. query_ledger 매칭 보강 (클라이언트 툴 실행부)
- 파일: `src/components/chat/AIChatPanel.jsx`
- 반영:
  - `fuzzySourceMatch()` 추가: 긴 문장형 소스 힌트에서 핵심 토큰 매칭
  - `fuzzyCategoryMatch()` 추가: `교통비` ↔ `교통/차량` 표현 차이 보정
  - **fallback 추가**: category 값이 실제 카테고리와 안 맞으면 merchant 키워드로 자동 전환
    - 예: 모델이 `헬스장`을 category로 넣어도 상호/메모에서 검색

## 2-5. 규칙 문서 동기화
- 파일: `AI규칙.md`
- 반영:
  - 소스 표기 정책
  - tool-call 히스토리 짝 보존 규칙

---

## 3) 아직 해결 “완료 판정”이 안 난 포인트

- 코드 반영은 되었지만, 사용자 체감 기준으로는 아직 완전 신뢰 복구 전.
- 특히 아래를 **실사용 문장으로 재검증 필요**:
  1. “헬스장 얼마 사용했어?”
  2. “헬스장 이용권 있어?”
  3. “가계부 샘플에서 입력한 거래 삭제해줘”

검증 기준:
- 조회가 0건이면 왜 0건인지(필터/기간/소스)가 논리적으로 맞아야 함
- 있는 거래를 “없다”라고 말하면 실패
- 삭제 전 탐색(`query_ledger`) 대상 식별이 안정적이어야 함

---

## 4) 다음 세션 시작 즉시 할 작업 (우선순위)

1. **재현부터 고정**
   - 사용자 실제 문장으로 3개 시나리오 실행
   - 각 시나리오에서 `query_ledger` 인자(특히 category/merchant/location)를 확인

2. **모델 인자 오염 방지 보강**
   - `chat-assistant.js`에서 조회 intent일 때  
     “비카테고리 단어를 category로 밀어 넣지 않도록” 추가 가드 문장 보강
   - 필요하면 `query_ledger` 스키마 설명에 예시 확장 (`헬스장`은 merchant 우선)

3. **응답문 품질 보강**
   - 0건 응답 시 “현재 필터(기간/소스/카테고리)”를 짧게 노출해 오해 감소

4. **삭제 복구 전략(별도 태스크)**
   - 현재 하드삭제 구조라 완전 복원이 어려움
   - soft delete/undo(휴지통) 설계 태스크를 분리해서 진행

---

## 5) 기술 메모 (현 구조)

- 거래 저장 정본: IndexedDB `ledger_lines`
- `VaultTransaction` 주요 필드:
  - `source`: `upload | gmail | manual | webhook`
  - `location`: 현재 소스 라벨/참조 텍스트 용도로 사용 중
  - `userMemo`: 메모
- 삭제는 현재 `deleteLine()`에서 하드삭제

---

## 6) 최신 커밋 상태

- 최신 푸시 커밋: `4bb6250`
- 포함 내용:
  - tool-call 히스토리 정합성 복구
  - 소스 표기 정책 UI 반영
  - query_ledger 소스/카테고리/상호 매칭 보강
  - 규칙 문서 업데이트

---

## 7) 다음 세션 작업 원칙

- 사용자 체감 성공 전까지 “해결 완료” 단정 금지
- 수정 후 반드시:
  - 재현문 3종 테스트
  - build 확인
  - 깃 세트(`add -A → commit → push`) 누락 없이 즉시 수행

