# 👥 User Integration & Guest Trial Bridge Guide

본 문서는 개별 패밀리 앱의 유저 DB 연동 전략, 세션 동기화, 그리고 비회원 선체험(가불정산) 및 데이터 이관 스펙에 대한 명세입니다.

---

## 1. 개별 앱 유저 연동 전략 (User Integration)
개별 앱(Individual App)은 고유의 사용자 테이블을 유지하며, 허브의 공식 식별자를 연동 키로 사용합니다.

### 1단계: DB 스키마 설계 표준
신규 패밀리 앱 개발 시 아래와 같은 네이밍 표준을 권장합니다.
- **테이블 명**: `users`
- **연동 컬럼**: `id` (UUID) — 허브의 `family_users.id` 값을 그대로 저장합니다.
- **참고**: 이미 구축된 앱은 `t_users`, `f_id` 등 고유의 네이밍을 사용할 수 있으나, 신규 연동 시에는 위 표준을 따릅니다.

### 2단계: 세션 동기화 (Upsert 패턴)
로그인 성공 시 반환되는 `user.id`를 사용하여 로컬 유저 레코드를 생성하거나 업데이트합니다.

```typescript
// 예시: 허브 로그인 완료 후 로컬 DB(users)와 동기화
const { user, isLoggedIn } = useHub();

useEffect(() => {
  if (isLoggedIn && user) {
    // 로컬 API 호출: 
    // 1. users 테이블에서 id === user.id 인 레코드가 있는지 확인
    // 2. 없으면 신규 생성(Insert), 있으면 최신 정보 업데이트(Update)
    fetch('/api/auth/sync-user', {
      method: 'POST',
      body: JSON.stringify({ 
        hub_id: user.id, // 허브의 family_users.id
        email: user.email 
      })
    });
  }
}, [isLoggedIn, user]);
```

### 3단계: 데이터 관리 책임 분할
- **허브(Hub)**: 계정(`family_users`), 통합 잔액(`family_wallet_balances`).
- **로컬(Local)**: 앱 전용 설정, 포인트, 활동 로그 등 (`users`).

---

## 2. 비회원 선(先) 체험 가불 정산 및 데이터 이관 스펙
유저에게 가입이나 결제를 요구하기 전에 서비스 핵심 기능을 1회 맛보게 하고, 로그인 가입 시 지급되는 웰컴 보상(`500C`)에서 체험 비용을 사후 차감함과 동시에 해당 활동 이력을 진짜 유저 계정(UUID)으로 이관하는 표준 스펙입니다.

- **스토리지 키 표준**:
  - `pending_usage_fee`: 맛보기 시 발생한 가불 코인 금액 (예: `34`)
  - `pending_video_id`: 맛보기로 생성/분석된 로컬 엔티티 고유 ID
- **인증 연동**: `verifyOTP` 호출 시 `pendingUsageFee`와 `pendingVideoId` 인자를 전달하면 허브 백엔드가 원자적 결제를 대행합니다.
- **데이터 이관**: 가입 성공 직후 개별앱 내 `/api/analysis/link-guest`와 같은 엔드포인트를 호출하여 해당 비디오/기록의 `f_user_id`를 임시 ID(`trial_...`)에서 정식 유저 ID(진짜 UUID)로 변경합니다.

> 📘 **상세 스펙 가이드**: 상세한 데이터 흐름 시퀀스 다이어그램 및 개별앱 연동 코드는 [비회원 선체험 가불정산 및 데이터 이관 가이드](../../docs/비회원_선체험_가불정산_및_데이터_이관_가이드.md)를 참고해 주시기 바랍니다.
