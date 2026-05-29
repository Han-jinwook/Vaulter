# 🧩 Profile, Settings & Session Integration Guide

본 문서는 Merlin Hub SDK의 프로필, 설정 카드 및 세션 관리 모듈에 대한 연동 명세입니다.

---

## 1. 주요 모듈 & Hooks
- **부품 Hooks**: `useHubSession` (Core), `useHub` (Core Logic)
- **부품 Components**: 
  - `HubProfileWidget`, `HubAvatar` (헤더 아바타 위젯)
  - `HubProfileCard` (프로필/닉네임/사진 수정 카드)
  - `HubNotificationCard` (단일 스마트 알림 동의 카드)
  - `HubLogoutCard` (계정 로그아웃 카드)

---

## 2. 설정 페이지 (/p-settings) 조립 표준
개별 패밀리 앱들은 팝업 모달 대신 온전한 페이지(`/p-settings`)를 생성하여 아래와 같이 SDK 카드 컴포넌트를 조립해 배치해야 합니다.

```tsx
import { 
  HubProfileCard, 
  HubNotificationCard, 
  HubLogoutCard 
} from '@/src/services/merlin-hub-sdk/react';

// 설정 페이지 조립 예시
export default function SettingsPage() {
  const [smartNotification, setSmartNotification] = useState(true);
  
  // 알림 토글 변경 시 개별 앱 백엔드 API 연동
  const handleToggle = async (newValue: boolean) => {
    setSmartNotification(newValue);
    await fetch('/api/subscription/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: userId, enabled: newValue })
    });
  };

  return (
    <div className="space-y-6">
      {/* 1. 상단: 프로필 카드 */}
      <HubProfileCard />

      {/* 2. 중단: 스마트 알림 카드 (앱 전용 설명문 주입) */}
      <HubNotificationCard
        title="알림 설정"
        toggleLabel="🔔 스마트 알림"
        description="이 앱의 서비스 목적에 최적화된 중요 알림 설명을 주입합니다."
        enabled={smartNotification}
        onChange={handleToggle}
      />

      {/* 3. 하단: 로그아웃 카드 */}
      <HubLogoutCard onLogout={() => router.push('/')} />
    </div>
  );
}
```

> 🚨 **[중요] 불필요한 개별 헤더/타이틀 중복 배치 금지**
> `HubProfileCard` 및 `HubNotificationCard` 등 각 카드 블록 내부에는 자체적인 타이틀 영역("프로필 정보", "알림 설정" 등)이 이미 포함되어 있습니다.
> **따라서 카드 상단에 별도로 "설정", "프로필 및 알림" 같은 자체 헤더 텍스트나 부연설명글을 중복으로 하드코딩하지 마십시오. 화면이 지저분해지고 UX가 훼손됩니다.**
