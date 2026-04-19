# Vaulter Gmail UX 이슈 인수인계 (리셋본 v4 — 내부 로그와 화면 표시 불일치)

- 작성 일시: 2026-04-18 23:20 (+09:00 KST)
- 작성 목적: 내부 에이전트 계측 강화 후, **콘솔상 상태 전이는 success까지 완료되는데 실제 화면 버튼 라벨은 여전히 `권한 요청 중...`으로 보이는 모순**이 확인되어, 외부 협력자가 즉시 투입될 수 있도록 현재 상태/로그/가설을 종합 정리.

---

## 1. 현재 재현 증상 (사용자 확인 기준 · v4 시점)

- 새로고침 → `Gmail 연동` 클릭 → 라벨이 `권한 요청 중...`으로 전환되고 **최소 2분간** 그대로 고정.
- 이번 세션에서 투입한 하드 타임아웃(25초) 및 내부 step 타임아웃(10초) 중 어느 것도 화면상 복구되지 않은 것으로 관찰됨.
- 증상 발생 시점에 팝업은 뜨지 않았거나, 팝업이 뜨고 사용자가 닫았거나 — 그 맥락은 아직 미확인 (외부 협력자가 재현 시 체크 필요).
- 에러 토스트 / alert / console error 모두 사용자 체감상 없음.
- **가장 중요한 추가 관찰(v4):** 콘솔 로그상으로는 `oauth callback ok` 이후 `validate ok → digestPref ok → notif skip → swReady ok → sw messages posted`까지 모두 통과했고, 마지막에는 `state { connectState: 'success', gmailSyncPhase: 'idle' }`까지 찍혔다. 그런데도 사용자가 실제로 본 버튼 라벨은 계속 `권한 요청 중...`이었다고 진술했고, 그 체감 때문에 새 세션까지 리셋해 다시 온 상황이다.
- 즉 현재 이슈는 단순한 OAuth pending이 아니라, **내부 state/log와 실제 렌더 결과(또는 사용자가 보는 DOM)가 불일치하는 렌더링/반영 계층 문제**로 격상한다.

스크린샷: 좌측 버튼 라벨이 `권한 요청 중...` 상태로 고정 (우측 `Gmail 기록 초기화`는 정상 유휴 상태).

---

## 2. 관련 파일 (이번 세션 수정 / 조사 범위)

- `src/components/layout/TopNavBar.jsx` — 연동/초기화 버튼, 로컬 상태머신 (핵심 수정 대상)
- `src/stores/uiStore.js` — 전역 `gmailSyncPhase`, `lastGmailSyncAt` 등
- `src/App.jsx` — Service Worker 메시지 리스너 (`GMAIL_SYNC_PARSED/STATUS/ERROR/AUTH_EXPIRED`) → `setGmailSyncState` 갱신
- `src/lib/gmailSync.ts` — Google Identity Services(GIS) 토큰 요청, IndexedDB, 프로필 검증 API
- `public/sw.js` — 백그라운드 Gmail 수집/파싱 (현재 404 burst의 원인으로 의심)

---

## 3. 이번(v3~v4) 세션에서 에이전트가 반영한 변경

파일: `src/components/layout/TopNavBar.jsx`

1. **단일 상태머신화**
   - 버튼 라벨을 `CONNECT_LABELS[connectState]` 딕셔너리로만 렌더.
   - `gmailSyncPhase`는 `useEffect`에서 보조 시그널(→ `connectState` 보정)로만 사용. 라벨 문자열에 직접 개입하지 않음.
2. **하드 타임아웃을 ref 기반으로 전환**
   - `connectTimeoutRef` + `armConnectHardTimeout()` (25s) — `requesting_auth` 진입 시 즉시 장착.
   - 성공/실패 경로 모두 `clearConnectTimer()` 호출, 언마운트 cleanup 포함.
3. **step 타임아웃 유지**: `withTimeout(connectGmailReadonly(), 10_000)`, `withTimeout(validate+setDigest+notif+swReady, 10_000)`.
4. **피드백 채널 토스트 통일**
   - 기존 `window.alert` 제거.
   - 기존 `resetToast`를 공용 `toast` (`{type: 'success'|'error', message}`)로 통합. 3.5초 자동 소멸.
5. **syncing watchdog 유지**: `connectState === 'syncing'`이 35초 이상 지속되면 강제 idle 복귀.
6. **임시 관측 로그 추가**: `console.info('[GmailConnect] enter handleConnectGmail' | 'oauth callback ok' | 'hard timeout fired' | 'syncing watchdog → idle' | 'failure', ...)`
7. **verifying 단계 세부 로그 추가 (v4)**
   - `validate start/ok`
   - `digestPref start/ok`
   - `notif start/ok/skip`
   - `swReady start/ok/fail`
8. **하드 타임아웃 구현 변경 (v4)**
   - `setTimeout` 대신 `setInterval + performance.now()` 폴링으로 교체.
   - OAuth 팝업으로 포커스가 넘어가도 브라우저 타이머 스로틀 영향을 줄이기 위한 목적.
9. **상태 전이 로그 추가 (v4)**
   - `console.info('[GmailConnect] state', { connectState, gmailSyncPhase })`
   - 목적: 내부 상태와 실제 화면 라벨이 일치하는지 비교.

린트는 통과. 다만 v4 관찰 결과, **HMR 미반영보다는 “state는 success인데 화면은 requesting_auth처럼 보이는 불일치”가 핵심**으로 바뀜.

---

## 4. 이번(v3) 세션에서 확인한 백그라운드 서버 로그 실증

터미널 로그 파일 위치 (Windows): `C:\Users\WD\.cursor\projects\d-Vaulter\terminals\`.

### 4.0 2026-04-19 추가 정정: 현재 로컬 검증 기준 포트

- 이 문서의 초반부는 `5174(vite)` vs `8888(netlify dev)` 이원 구조를 전제로 작성되었으나, **현재 코드베이스는 `@netlify/vite-plugin`이 이미 활성화된 상태**다.
- 따라서 **기존 Vite dev 서버(`npm run dev` / `http://localhost:5173`)에서도 `/api/analyze-email-receipt`, `/api/analyze-document`가 응답**하는 것이 실제로 확인되었다.
- 반대로 이번 세션에서 `netlify dev`를 다시 띄우면 `index.html`을 import-analysis 대상으로 잘못 해석하는 blank page 문제가 재현되었다.
- 결론: **현 시점의 단일 로컬 재현 기준은 `http://localhost:5173`** 으로 잡는 것이 안전하다. `8888`은 우선순위를 낮추고, 정말 필요할 때만 별도 복구를 시도한다.

### 4.1 여러 dev 서버가 병렬로 살아 있음 (충돌/혼선 요인)

- `110767.txt` — `npx vite --host 127.0.0.1 --port 5174` (PID 17944, 약 5시간 실행 중)
- `178307.txt` — `netlify dev` (포트 8888, vite 5173 점유) — 현재도 running으로 추정
- 에이전트가 추가로 `npm run dev:netlify` 시도 시 **포트 8888 충돌로 즉시 exit 1**. → 기존 프로세스가 안 죽은 상태.

> **외부 협력자 첫 번째 할 일**: 어떤 서버(5174 vs 8888)에 붙은 브라우저에서 증상이 재현되는지 확정 후, 나머지 서버는 종료하여 혼선 제거.

### 4.2 HMR 반영 의심 → v4에서 일부 해소

- `110767.txt` / `178307.txt` 양쪽 모두 **마지막 HMR 이벤트가 `오후 7:23:00 [vite] hmr update TopNavBar.jsx`**. 이후 3시간 이상 HMR 없음.
- 에이전트가 v3 파일 저장한 시점(대략 `오후 7:25` 이후)의 HMR 로그가 **누락**됨.
- 브라우저 콘솔에 `[GmailConnect]` 로그가 하나도 안 찍혔다면 → **구 버전 코드가 여전히 실행 중**. 새로고침/SW 갱신 필요.
- 단, v4에서는 사용자가 `[GmailConnect] enter handleConnectGmail`, `oauth callback ok`, step 로그, 마지막 `state { connectState: 'success', gmailSyncPhase: 'idle' }`까지 직접 제공함.
- 따라서 **적어도 TopNavBar의 최신 계측 코드는 실제 브라우저에서 실행되었다고 보는 것이 타당**. HMR 미반영은 더 이상 1순위 가설이 아님.

> **외부 협력자 두 번째 할 일**:
> - DevTools → Application → Service Workers → **Unregister** 후 하드 리로드 (`Ctrl+Shift+R`).
> - 콘솔에서 `[GmailConnect] enter handleConnectGmail` 로그가 찍히는지 확인.
> - 그래도 구 코드 그대로면 dev 서버 재시동 (아래 4.4 참고).

### 4.3 Service Worker가 `parse failed 404` 대량 발사

`178307.txt`에서 반복적으로 관찰된 경고:

```
[vite] (client) [console.warn] [GmailSync] service worker error: [19xxxxx] parse failed 404
```

- `sw.js`가 Gmail 메시지 파싱을 위해 `/api/analyze-email-receipt` 또는 `/.netlify/functions/analyze-email-receipt`로 POST하는데,
- **순수 vite 서버(5174)에는 Netlify Functions가 없으므로 무조건 404**.
- `netlify dev`(8888) 접속이면 정상이지만, 사용자가 5174로 접속했다면 `GMAIL_SYNC_ERROR` burst가 App.jsx 리스너에 들어와 `setGmailSyncState('error', ...)`를 반복 트리거할 수 있음.
- 이 상황에서는 `connectState`가 `requesting_auth`인 동안 `gmailSyncPhase='error'` 이벤트가 끼어들어 **state 경합**이 추가로 발생 가능.

> **추가 정정(2026-04-19):** 위 설명은 `5174`의 순수 vite 서버를 기준으로는 여전히 맞지만, **현재 실사용 중인 `5173` dev 서버는 `@netlify/vite-plugin` 덕분에 `/api/*` 함수가 응답**한다. 따라서 최신 재현에서는 `5173`을 404 원인으로 단정하면 안 된다.

> **외부 협력자 세 번째 할 일(정정):** 반드시 `http://localhost:5173` 기준으로 재현하고, 다른 포트 탭은 닫아 혼선을 제거한다.

### 4.4 dev 서버 재시동 절차 (PowerShell)

```powershell
# 1) 8888/5173/5174를 점유하는 프로세스 탐지
Get-NetTCPConnection -LocalPort 8888,5173,5174 -ErrorAction SilentlyContinue |
  Select LocalPort,OwningProcess,State

# 2) 각 PID 종료
Stop-Process -Id <PID> -Force

# 3) 프로젝트 루트에서 단일 dev 서버만 실행
cd D:\Vaulter
npm run dev            # → http://localhost:5173
```

---

## 5. 핵심 가설 (우선순위순 · 외부 협력자 검증용)

### H1. 내부 state는 success인데 실제 버튼 라벨 렌더 결과가 stale 상태로 남아 있는 UI 불일치 (최우선)

- 근거:
  - 사용자 제공 콘솔 로그상 `connectState: 'success', gmailSyncPhase: 'idle'`까지 도달.
  - 그런데 사용자 스크린샷과 체감은 계속 `권한 요청 중...`.
  - 즉 **state machine 자체보다 렌더 반영/DOM 갱신/사용자가 보고 있는 인스턴스**가 문제일 가능성이 높음.
- 검증:
  - 버튼 텍스트를 렌더 직전에 `const connectLabel = CONNECT_LABELS[connectState] || CONNECT_LABELS.idle`로 변수화하고, `console.info('[GmailConnect] render label', { connectState, connectLabel, gmailSyncPhase })` 추가.
  - 버튼 DOM에 `data-connect-state={connectState}` / `data-connect-label={connectLabel}`를 부여하고 Elements 탭에서 실제 속성값 확인.
  - React DevTools로 해당 `TopNavBar` 인스턴스 state 확인.
  - 동일 화면에 TopNavBar가 중복 마운트돼 있지 않은지 확인.
- 개선안:
  - 라벨 계산을 렌더 시점 변수로 고정하고, 버튼에 `key={connectState}`를 잠시 부여해 강제 리렌더 여부 확인.
  - 최악의 경우 `connectState`를 로컬 state가 아니라 store에 올려 단일 source of truth화.

### H2. 사용자가 보고 있는 화면이 기대 인스턴스가 아닌 다른 dev 서버/탭/캐시된 클라이언트일 가능성

- 근거:
  - 5174(vite) / 8888(netlify dev) 두 서버가 병렬로 살아 있음.
  - 콘솔 로그는 한 탭 기준이지만, 사용자가 본 스크린샷이 다른 origin/탭/iframe일 가능성을 아직 완전히 배제 못 함.
- 검증:
  - 주소창 origin을 캡처 (`localhost:8888`인지 `127.0.0.1:5174`인지).
  - Console과 스크린샷이 같은 탭/같은 시점인지 확인.
  - `document.querySelector('header button[title^="Gmail 읽기 전용 연동"]')?.dataset`로 실제 DOM dataset 읽기.

### H3. GIS `requestAccessToken()`이 OAuth 팝업도 못 띄우고 callback 무호출

- GIS는 팝업 차단 / COOP / COEP / 서드파티 쿠키 차단 환경에서 silent하게 fail하는 사례가 보고됨.
- `callback`이 호출되지 않으면 `connectGmailReadonly()` Promise는 영원히 pending.
- `withTimeout(…, 10_000)`이 reject시켜야 하는데, **탭이 백그라운드로 전환되면 브라우저가 setTimeout을 >1s로 throttle**하는 경우가 있어 10초 타임아웃이 실제로는 수십 초~분 단위로 지연 가능.
- 검증:
  - 콘솔에서 `window.google?.accounts?.oauth2` 존재 여부, 에러 이벤트 여부.
  - `VITE_GOOGLE_CLIENT_ID`가 localhost origin에 대해 등록되어 있는지 (GCP Console → OAuth 2.0 Client IDs).
  - `about://blocked` / popup blocker 상태.
  - `document.cookie`에서 `SameSite=None; Secure` 관련 third-party cookie 차단 여부.
- 개선안:
  - `ux_mode: 'popup'` 대신 `ux_mode: 'redirect'`로 전환 검토.
  - 또는 GIS `initTokenClient` 대신 `initCodeClient` + Auth Code 흐름으로 재설계.
  - 하드 타임아웃을 `performance.now()` 기반 RAF 루프로 두어 탭 스로틀 영향 최소화.

### H4. SW 404 burst에 의한 `gmailSyncPhase` 진동이 `connectState`를 끈질기게 되돌림

- 현재 v3 코드에서 `gmailSyncPhase === 'error'` 시 `setConnectState('error')` → 6s 후 idle. 그러나 `requesting_auth` 중에 이 경로가 끼어들면 **OAuth 콜백이 뒤늦게 오더라도 이미 idle로 돌아가 있어 사용자 혼선** 가능.
- 또한 이 이벤트가 아주 빠르게 연속 오면 `setConnectState`가 진동하며 UX 불일치.
- v4 로그에서도 `state Object`가 다수 연속 찍혀 `gmailSyncPhase` 진동 정황이 남아 있음.
- 개선안:
  - `connectState`가 `requesting_auth | verifying`일 때는 `gmailSyncPhase` → `connectState` 동기화를 **무시**.
  - 동시에 `sw.js`의 파싱 실패 404를 연동 실패로 해석하지 않도록 `GMAIL_SYNC_ERROR` 타입을 세분화 (e.g. `type: 'parse_failed'` vs `type: 'auth_expired'`).

### H5. `requesting_auth` state의 타이머가 HMR 재마운트로 유실

- Fast Refresh는 React state는 보존하지만, 컴포넌트가 재평가될 때 기존 `useRef` 타이머가 소멸/재생성될 수 있음.
- 현 구현에서 `armConnectHardTimeout()`은 **버튼 클릭 핸들러 내부에서만** 장착되므로, 재마운트 후에는 타이머 없이 state만 남는 케이스가 가능.
- 개선안:
  - `connectState === 'requesting_auth' || 'verifying'`이면 마운트/업데이트 시 항상 하드 타임아웃을 재장착하는 `useEffect` 추가.
  - 또는 mount 시 `requesting_auth`가 이미 stale이라면 즉시 `idle`로 리셋.

---

## 6. 외부 협력자 체크리스트 (이 순서대로 진행 권장)

1. [ ] **환경 정리**: 5174와 8888 dev 서버 중 하나만 남기고 나머지 종료. 브라우저 탭 정리.
2. [ ] **SW 정리**: DevTools → Application → Service Workers → Unregister → 하드 리로드.
3. [ ] **주소창 origin 확인**: 사용자가 보는 화면이 `5173`인지 우선 확인하고 캡처. (`8888`은 현재 blank page 가능성 높음)
4. [ ] **재현**: `Gmail 연동` 클릭. 팝업이 뜨는지 / 차단되는지 / 사용자가 닫는지 기록.
5. [ ] **실제 렌더값 검증**: 버튼 DOM에 `data-connect-state`, `data-connect-label` 부여 후 Elements/Console에서 실제 값 확인.
6. [ ] **React DevTools 확인**: `TopNavBar`와 `uiStore`의 실제 `gmailConnectState` / DOM 텍스트가 일치하는지 확인.
7. [ ] **H1 검증 완료 후에도 화면 고정이면 H2~H5 순차 검증**.
8. [ ] **GCP OAuth Client 재확인**: JavaScript origins에 `http://localhost:5173` / `http://localhost:8888` / `http://localhost:5174` / `http://127.0.0.1:5174` 중 실제 접속 origin이 등록되어 있는지.
9. [ ] **gmailSync.ts** 수정 검토:
   - `initTokenClient`에 `error_callback` 파라미터 추가해서 popup_closed/popup_failed_to_open 포착.
   - 팝업 실패 시 명시적 reject.
10. [ ] **sw.js** 수정 검토:
   - 404 연속 발생 시 자동 backoff + 유저 연동 상태에 영향 안 주도록 에러 분류.

---

## 7. 사용자 정책(에이전트가 반드시 준수)

- **성공 판정은 사용자 본인**이 한다. 에이전트는 로컬 빌드/검증 결과만 보고하고, "성공" 확정 멘트 금지.
- **커밋/푸시는 사용자 성공 확인 후에만** 진행. 커밋 시에는 해시 / 일시 / 1~2줄 한글 코멘트 간략 보고.
- 서버는 백그라운드 유지. 로그는 **에러 발생 시 최근 N줄만** 확인.
- 터미널 로그 경로 참고: `C:\Users\WD\.cursor\projects\d-Vaulter\terminals\*.txt`.

---

## 8. 과거(v1/v2) 커밋 이력 (UX 이슈 관련)

- `6e2b51c97c2892ce7f93ecc96d2318c970c88baa` — 상태 충돌 완화 + 자동 동기화 경로 제거 1차
- `1b565885f93f74701edbc498542490175309e75e` — 성공 alert 제거 + 초기화 상태 고정 완화
- `3a31efe60a9b67edaaf82b0f6f48f23c22ef7f92` — 완료/실패 피드백 보강 (non-blocking 문구)
- `2c7398902112d7ad41ed6887033c4114619514c6` — 초기화 단일 종료 경로 + 하드 타임아웃 가드

v3/v4는 아직 **미커밋** (사용자 성공 확인 대기).

---

## 9. 빠른 재현 시나리오 (v4 기준)

1. 단일 dev 서버만 기동 (`npm run dev` → `http://localhost:5173` 권장).
2. SW unregister + 하드 리로드.
3. DevTools Console 열어둔 채로 `Gmail 연동` 클릭.
4. DevTools Console에서 `[GmailConnect] state`, `[GmailConnect] step:` 로그를 함께 수집.
5. Elements 탭에서 Gmail 버튼의 실제 텍스트/`data-*` 속성을 확인.
6. 60초 이상 관찰:
   - 정상: 실제 DOM 텍스트와 내부 state가 함께 전이.
   - 비정상(재현): 콘솔은 `success`까지 가는데, 화면 또는 DOM 텍스트는 `권한 요청 중...`으로 남음.
7. 비정상 재현 시 콘솔 로그 / Network 탭 / Application → Service Workers 상태 / `[GmailSync] ...` 경고 / 주소창 origin을 전부 캡처.

---

## 10. 2026-04-19 추가 인수인계: Drive 백업금고 통합 온보딩 + 데이터 초기화 이슈

- 작성 일시: 2026-04-19 15:10 (+09:00 KST)
- 작성 목적: Gmail 전용 연동 UX를 넘어, **Google 통합 온보딩( Gmail + Drive appData 백업 )** 으로 흐름을 전면 재구성한 뒤 남은 문제와 현재 상태를 다음 세션에서 이어받을 수 있도록 정리.

### 10.1 제품 의도 최종 확정

사용자 기획 의도는 아래로 확정되었다.

1. **로컬 본진(Source of truth)**
   - 원장은 브라우저 로컬 저장소(IndexedDB 기반 로컬 스냅샷)가 정본이다.
   - Gmail 자동 수집 / 문서 업로드 / 수기 수정 결과도 모두 로컬 원장에 먼저 반영된다.

2. **Google Drive는 개인 백업금고**
   - 일반 Drive 파일함이 아니라 `appDataFolder` 숨김 공간을 사용한다.
   - `vaulter_backup.json` 스냅샷 1개를 덮어써 상시 백업하는 구조다.
   - 사용자가 평소 작업 소스로 Drive 파일을 “가져오는” 개념이 아니다.

3. **통합 Google 연결 UX**
   - 사용자가 첫 Gmail 연동 또는 첫 파일 업로드를 시도할 때,
   - Google 팝업을 바로 띄우지 않고,
   - 안내 모달 `Vaulter(금고지기) 100% 활용하기`를 먼저 띄운다.
   - 이 모달에서 **한 번의 OAuth** 로 `gmail.readonly` + `drive.appdata`를 동시에 승인한다.

4. **설정(Settings) 역할**
   - 권한을 받는 진입점이 아니라,
   - 현재 연결 상태 / 마지막 백업 시각 / 지금 백업 / 복원 / 연결 해제만 보는 조회 공간이다.

### 10.2 이번 세션에서 실제 반영한 코드 변경

#### A. 문서 업로드 파이프라인 (이전 작업, 이미 성공 케이스로 푸시됨)

- `CSV / XLS / XLSX / 텍스트 레이어 PDF / 이미지 영수증` 업로드 지원
- 브라우저 로컬 전처리 후 청크 단위 GPT 텍스트 분석
- `PENDING` 원장 + 채팅 검토 흐름 연결
- 관련 푸시 해시:
  - `e625369652ee46bef9a86fecf27d3a361bd441cc`
  - `67be08effdd4c39cfefc0564d0f6822a12f31a0c`

#### B. Google Drive 백업금고 1차 구현

추가 / 수정 파일:

- `src/lib/googleDriveSync.ts`
  - Drive `appDataFolder` 백업금고용 토큰 저장 / 상태 조회 / 업로드 / 복원
- `src/lib/localVaultPersistence.ts`
  - 로컬 원장 스냅샷 저장 / 읽기
- `src/stores/vaultStore.ts`
  - `exportBackupSnapshot()`
  - `restoreFromBackupSnapshot()`
- `src/App.jsx`
  - 앱 부팅 시 로컬 스냅샷 bootstrap
  - 원장 변경 감지 후 로컬 저장 + Drive 자동 백업
- `src/components/settings/SettingsModal.jsx`
  - 백업 상태 확인 / 지금 백업 / 백업 복원 / 연결 해제

#### C. 통합 Google 온보딩 UX로 재수정

추가 / 수정 파일:

- `src/lib/googleIntegration.ts`
  - `gmail.readonly` + `drive.appdata`를 한 번에 승인하는 통합 OAuth 헬퍼
- `src/components/google/GoogleConnectModal.jsx`
  - 권한 요청 직전 안내 모달
- `src/components/upload/FileUploadOverlay.jsx`
  - 첫 업로드 시 통합 연결 상태가 없으면 안내 모달을 먼저 띄우도록 변경
- `src/components/layout/TopNavBar.jsx`
  - Gmail 버튼도 같은 통합 모달을 타게 변경
  - 승인 후에는 별도 Gmail OAuth 없이 저장된 통합 토큰으로 검증 / 동기화 진행
- `src/components/settings/SettingsModal.jsx`
  - “연결 만드는 곳”이 아니라 “상태 확인 / 복원 / 해제” 중심으로 역할 축소

### 10.3 현재 확인된 UX 상태

사용자 기준으로 확인된 점:

- 영수증 처리 시점에 Google 권한 팝업이 먼저 떠서 당황할 수 있다는 피드백이 있었다.
- 그에 따라 권한 목적 설명이 선행되어야 한다는 요구가 확정되었다.
- 숨김 공간 백업은 제품 개념상 맞지만,
  **권한 요청 전 목적 안내** 가 반드시 필요하다는 결론.

현재 코드상 의도:

- Gmail 연동 클릭 / 첫 파일 업로드 시 → `GoogleConnectModal` 선노출
- CTA `구글 계정으로 한 번에 연결하기` 클릭 시 → 실제 OAuth 팝업
- 승인 직후 → Gmail 검증 + Drive appData 검증 + 초기 백업 업로드

### 10.4 데이터 초기화 이슈 (이번 세션 말미에 새로 확인)

#### 사용자 증상

- “data 초기화” 후에도 채팅창의 예시 대화 / 샘플 거래가 남아 보임
- 스크린샷상:
  - `안녕하세요! 금고지기 AI입니다...`
  - `카카오페이 송금`
  - `두레밀면본점`
  - `송세프 장안점`
  등 샘플성 데이터가 그대로 렌더됨

#### 실제 원인

- `src/stores/vaultStore.ts`가 앱 시작 시 아래 하드코딩 샘플을 기본값으로 먼저 주입하고 있었다.
  - `initialTransactions`
  - `initialMessages`
- 한편 `src/App.jsx`는 로컬 스냅샷이 있을 때만 `restoreFromBackupSnapshot(localSnapshot)`을 호출하고,
  **로컬 스냅샷이 없을 때는 아무 조치도 하지 않아**
  샘플 시드가 그대로 살아남는 구조였다.

#### 이번 세션에서 반영한 수정

`src/App.jsx` bootstrap에서:

- 로컬 스냅샷이 있으면 → 그 스냅샷으로 복원
- 로컬 스냅샷이 없으면 → 샘플 시드를 유지하지 않고 아래 빈 상태로 강제 복원

복원 대상 빈 상태:

- `transactions: []`
- `messages: []`
- `knownAccounts: []`
- `lastLedgerDecision: null`
- `ledgerContextTitle: '데이터 원장 (전체)'`
- `activeLedgerFilter: 'all'`
- `reviewPinnedTxIds: []`

#### 검증 상태

- 린트 통과
- `npm run build` 통과
- **하지만 사용자가 아직 이 수정으로 실제 초기화 문제가 해결됐다고 확인하지는 않음**

즉, 다음 세션에서는 이 부분을 먼저 사용자 화면 기준으로 재확인해야 한다.

### 10.5 다음 세션에서 가장 먼저 할 일

우선순위 순:

1. **초기화 재검증**
   - 데이터 초기화 실행
   - 새로고침
   - 채팅 예시 / 샘플 거래가 사라졌는지 확인

2. **통합 온보딩 재검증**
   - 첫 업로드 또는 Gmail 연동 클릭
   - `Vaulter(금고지기) 100% 활용하기` 모달이 먼저 뜨는지 확인
   - Google 팝업이 모달 CTA 이후에만 뜨는지 확인

3. **초기 백업 생성 확인**
   - 통합 승인 직후 설정 모달에서 `마지막 백업` 시각이 잡히는지
   - 이후 거래 수정 / 업로드 후 자동 백업 시각이 갱신되는지 확인

4. **설정 화면 역할 점검**
   - 연결 전용 진입점이 아니라 조회/해제용 공간으로 충분히 정리되었는지 UX 확인

### 10.6 현재 세션 종료 시점의 중요한 메모

- 통합 온보딩 + 백업금고 구조 변경은 **아직 미커밋 / 미푸시**
- 빌드는 통과했지만, 사용자 성공 판정 전이므로 커밋 금지
- 특히 `데이터 초기화 후 샘플이 다시 보이는 문제`는 이번 세션 말미에 급히 수정한 것이므로,
  새 세션에서 최우선으로 수동 검증할 것

### 10.7 관련 핵심 파일 목록 (이번 추가 이슈 기준)

- `src/App.jsx`
- `src/stores/vaultStore.ts`
- `src/stores/uiStore.js`
- `src/lib/localVaultPersistence.ts`
- `src/lib/googleDriveSync.ts`
- `src/lib/googleIntegration.ts`
- `src/lib/gmailSync.ts`
- `src/components/google/GoogleConnectModal.jsx`
- `src/components/upload/FileUploadOverlay.jsx`
- `src/components/layout/TopNavBar.jsx`
- `src/components/settings/SettingsModal.jsx`
