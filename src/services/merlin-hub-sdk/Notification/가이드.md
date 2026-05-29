# 📬 Notification Bridge Integration Guide

본 문서는 Merlin Hub SDK의 알림 브릿지(이메일 발송 및 구독 관리)에 대한 연동 명세입니다.

---

## 1. 주요 모듈 & Hooks
- **부품**: `useHubNotifier` (Core Hook)
- **용도**: 허브를 통해 이메일을 발송하고 유저의 알림 설정을 관리합니다.

---

## 2. 사용법 예시

```typescript
import { useHubNotifier } from '@/services/merlin-hub-sdk/Core/useHubNotifier';

const { sendEmail, updateSettings } = useHubNotifier();

// 알림 이메일 발송 예시
const handleSendAlert = async () => {
  await sendEmail({
    to: "user@example.com",
    subject: "[알림] 서비스 관련 중요 안내",
    html: "<p>안녕하세요, 패밀리 서비스 알림입니다.</p>"
  });
};
```
