# 💳 Payment, Coins & Pricing Integration Guide

본 문서는 Merlin Hub SDK의 통합 지갑 잔액, 결제 위젯, 그리고 실시간 동적 과금 규격에 대한 명세입니다.

---

## 1. 주요 모듈 & Components
- **부품 Hooks**: `useHubPayment` (Core)
- **부품 Components**:
  - `HubPaymentTrigger` (KCP 결제 팝업 트리거 브릿지)
  - `HubPurchaseWidget` (결제 및 코인 충전/이용 내역 올인원 위젯)

---

## 2. 결제 위젯 (`HubPurchaseWidget`)
유저의 실시간 잔액 표시, 충전/이용내역 탭 전환, 상품 카드 렌더링, 결제 수단 선택(신용카드/휴대폰), 결제창 브릿지 연동, 이용 내역 조회 및 페이징 처리까지 모든 결제 관련 UI와 로직을 내장한 올인원 위젯입니다.
- **적용법**:
```tsx
import { HubPurchaseWidget } from '@/src/services/merlin-hub-sdk/react';

// Next.js Page 컴포넌트 내에서 간편 호출
<HubPurchaseWidget 
  appName="어그로필터" 
  redirectUrl="/" 
/>
```

---

## 3. [표준] 개별 앱 실시간 동적 과금 연동 규격 (Stateless Immediate Billing)

모든 패밀리 앱의 과금 계산(환율, 마진, 최소/최대 가격)은 **허브(Hub) 백엔드 서버에서 일괄 제어**합니다. 개별 앱은 AI API 호출(GPT, Gemini 등) 직후 아래 가이드에 따라 **소모한 토큰량(실지 메트릭)을 허브로 즉시 전송**하여 실시간 과금합니다.

- **설계 원칙**: 개별 앱 내부에 로컬 DB 캐싱이나 30분 버퍼링과 같은 복잡한 상태(State)를 유지하지 않는 **완전한 Stateless 구조**를 표준 규격으로 채택합니다.
- **연동 흐름**:
  1. 개별 앱 프론트엔드가 백엔드로 AI 요청을 보냅니다.
  2. 백엔드는 AI API를 호출하여 결과를 받고, **응답 객체 내에 포함된 실제 토큰 소모량(JSON)**을 읽습니다.
  3. 백엔드는 지체 없이 허브 SDK의 `chargeDynamic`을 호출해 결제 요청을 보냅니다.
  4. 차감이 성공하면, AI 분석 결과를 프론트엔드로 반환하여 화면에 표시합니다.

#### 💡 백엔드 통합 예제 코드 (Standard Implementation)
```typescript
import { configureMerlinHub, chargeDynamic } from '@/src/services/merlin-hub-sdk';

// 1. 최상위(또는 백엔드 초기화 시점)에서 App ID 설정
configureMerlinHub({ appId: 'YOUR_APP_ID' }); // 예: 'AggroFilter', 'Vaulter'

// 2. AI 작업 직후 실시간 차감 수행
async function handleAiAction(userId: string, resourceId: string) {
  // [A] AI API 실행 (예: gpt-4o-mini 호출)
  const aiResponse = await openai.chat.completions.create({ ... });
  const rawTokens = aiResponse.usage?.total_tokens || 0;

  // [B] 허브 SDK를 통해 실시간 동적 과금 요청
  const billingRes = await chargeDynamic({
    userId: userId,                                        // 유저 고유 ID (family_users.id)
    videoId: resourceId,                                   // 과금 대상 리소스 고유 식별자 (예: 비디오 ID, 세션 ID 등)
    usageMetrics: {
      gpt4oMiniTokens: rawTokens,                          // 모델별 소모 토큰 수 (gpt4oMiniTokens | gemini25FlashTokens)
    },
    requestId: `charge_${resourceId}_${Date.now()}`,       // 이중 과금 방지용 멱등성 키
    displayText: "서비스 이용 - AI 기능 사용",                 // 유저 결제 내역에 표시될 텍스트
    usageMetadata: {                                       // [선택] CS 소명/로그 기록용 CCTV 상세 로그 객체
      cctv_logs: [
        { timestamp: new Date().toISOString(), action: "텍스트 요약", tokens: rawTokens }
      ]
    }
  });

  if (!billingRes.success) {
    throw new Error(`과금 실패: ${billingRes.error}`);
  }

  console.log(`과금 성공. 차감 잔액: ${billingRes.balance}`);
  return aiResponse.choices[0].message.content;
}
```

- **이중 과금 방어 (Idempotency)**: 통신 장애 등으로 인한 재시도시 중복 과금을 원천 방지하기 위해 `requestId`에 고유한 멱등성 키를 발급하여 전송해야 합니다.
- **허브 측 과금 설정**: 개별 앱은 스스로 요금을 연산하지 않고, 허브 DB의 `family_apps` 테이블에 정의된 과금 규칙(`margin_multiplier`, `token_to_coin_rate`, `min_price`, `max_price`)에 따라 허브 백엔드가 자동 계산합니다.
  - **`margin_multiplier`**: 동적 요금 계산 시 적용할 곱연산 마진 배수
  - **`token_to_coin_rate`**: 토큰 사용량을 코인으로 환산하는 비율
  - **`min_price`**: 과금 시 최소로 보장할 최저 코인 금액
  - **`max_price`**: 과금 시 최대로 부과할 최대 코인 금액 한도
