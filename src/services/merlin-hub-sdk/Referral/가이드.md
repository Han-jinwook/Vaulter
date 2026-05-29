# 🤝 Referral & Sharing Suite

본 문서는 Merlin Hub SDK의 추천인 시스템, 초대 보상 및 SNS/링크 공유 위젯에 대한 연동 명세입니다.

---

## 1. 주요 모듈 & Components
- **부품 Hooks**: `useHubReferral` (Core Hook)
- **부품 Components**:
  - `HubReferralWidget` (친구 초대 및 코드 복사 올인원 카드 위젯)
  - `HubShareButton` (공유 버튼)
  - `HubShareSquare` (내 초대 코드가 심어진 그라데이션 공유 위젯)

---

## 2. 공유 컴포넌트 적용 표준

```tsx
import { HubHistoryList, HubShareButton, HubShareSquare } from "@/services/merlin-hub-sdk/react";

// 1. 초대 실적 목록 (마이페이지 등)
<HubHistoryList history={referralHistory} isLoading={isHistoryLoading} />

// 2. 표준 공유 스퀘어 위젯 (우측 사이드윙 최상단 권장)
<HubShareSquare 
  customTitle="[어그로필터] 이 영상의 진실은?!"
  description="공유 링크에는 내 추천인 코드가 포함되어 혜택이 자동 적립됩니다."
  className="mb-4"
/>
```

---

## 3. 초대 시스템 (Referral System) 연동 구조
친구 초대 시 **초대자(Inviter)**와 **가입자(Invitee)** 모두에게 보상을 지급하는 시스템입니다.

### 1단계: 초대 링크 생성
초대자의 코드를 URL 파라미터에 포함하여 홍보 링크를 생성합니다.
- **형식**: `https://your-app.com?ref=INVITE_CODE`
- **SDK 위젯**: `HubReferralWidget`을 배치하면 유저가 자신의 코드를 즉시 확인하고 복사할 수 있습니다.

### 2단계: 가입 시 초대 코드 자동 인식
앱의 진입점(Landing 또는 Login 페이지)에서 URL의 `ref` 파라미터를 저장했다가 가입 시 허브로 전달합니다.

```typescript
// 예시: 초대 코드를 로컬 스토리지에 임시 저장
useEffect(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  if (refCode) {
    localStorage.setItem('pending_invite_code', refCode);
  }
}, []);

// 회원가입/로그인 시 허브 SDK에 전달
const { login } = useHub();
const pendingCode = localStorage.getItem('pending_invite_code');

const handleJoin = (email, otp) => {
  login(email, otp, pendingCode); // 세 번째 인자로 초대 코드 전달
};
```

### 3단계: 보상 정책 (Hub 기본값)
- **초대자(Inviter)**: 친구 가입 후 최초 기능 소모(가불 정산 또는 분석) 완료 시 **500C** 즉시 지급.
- **가입자(Invitee)**: 추천 가입에 따른 별도 추가 보상은 없으나, 모든 가입자는 최초 기능 사용 시 기본 웰컴 보상 **500C** 지급 (초대자 보상은 피초대자의 실제 사용이 일어나기 전까지 PENDING으로 안전하게 보호되어 가계정 어뷰징을 자동 방지합니다.)
