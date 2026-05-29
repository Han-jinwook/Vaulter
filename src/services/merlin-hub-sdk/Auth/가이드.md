# 🔒 Email Authentication Integrated Module (Auth Suite)

본 문서는 Merlin Hub SDK의 6자리 이메일 OTP 기반 통합 로그인 및 회원가입 모듈에 대한 연동 명세입니다.

---

## 1. 주요 모듈 & Components
- **부품**: `useHubAuth` (Core), `HubAuthModal` (Custom UI)
- **용도**: 이메일 OTP 발송 및 검증.
- **특징**: `requestOTP(email, appId)`를 통해 개별 앱별 맞춤형 이메일 발송(발송자명, 제목)이 동적으로 지원됩니다.

---

## 2. UI 커스텀 및 디자인 통합 (통일성 엄수) 가이드
허브 생태계 내의 모든 패밀리 앱들은 이메일 인증창(`HubAuthModal`)에 대해 **동일한 사용자 경험(UX)과 디자인(UI)**을 제공해야 합니다.
개별 앱은 모달을 사용할 때 **오직 아래의 2가지 항목만 Props로 커스텀**할 수 있습니다:
1. **상단 1줄 (앱 로고)**: `appLogoUrl` 프롭을 통해 개별 앱의 고유 로고 이미지를 삽입합니다. (모달이 자동으로 가로 세로 비율을 축소 최적화하여 깨지지 않게 렌더링합니다.)
2. **상단 2줄 (액션 목적 텍스트)**: `subtitleActionText` 프롭을 통해 "무료 코인 받아 **[분석에]** 사용하세요" 등 개별 앱의 성격에 맞는 텍스트로 치환합니다.

> 🚨 **[강력 권고] 스타일링 임의 변경 금지**
> 이메일 입력창의 텍스트 크기(`text-2xl`)와 플레이스홀더 스타일, 6자리 OTP 인증코드 입력칸의 큼직한 텍스트 크기(`text-3xl`), 테두리 두께(`border-[3px]`) 등은 허브 디자인 표준 규격입니다.
> **모든 패밀리 앱은 원본 스타일에 적용된 테두리 굵기, 색상, 글자 크기를 그대로 유지하여 일관된 생태계 연동 경험을 제공해야 합니다.**

---

## 3. [Custom] 혜택 알림 모달 (`HubBenefitModal`)
로그인(이메일 인증)을 하지 않은 비회원 유저가 무료 체험을 완료했을 때, 가입을 유도하기 위해 노출하는 표준 혜택 안내 모달입니다.
- **`useBenefitTrigger` 연동**: 앱 내에서 무료 체험 완료 시점에 SDK의 `markFreeTrialCompleted()`를 호출하면, 1분 지연 후 모달이 노출됩니다. 또한 "다음에 할게요"를 누른 후 재방문 시에는 5분 체류 후 노출되도록 지연 로직이 내장되어 있습니다.
- **커스터마이징 지원**: 공통 혜택(데이터 보존, 멀티 디바이스 연동) 외에 앱 전용 맞춤 혜택 1가지를 주입할 수 있습니다.

```tsx
import { HubBenefitModal, markFreeTrialCompleted } from '@/src/services/merlin-hub-sdk/react';

// 무료 분석 완료 등 이벤트 발생 시 호출
markFreeTrialCompleted();

// 최상위 레이아웃 혹은 전역 컴포넌트에 배치
<HubBenefitModal 
  customBenefitTitle="관심 채널 신뢰도 변동 알림"
  customBenefitDesc="관심 채널 신뢰도 단계(그린/옐로/레드)가 바뀌면 바로 알림"
  customBenefitIcon="🔔"
/>
```
