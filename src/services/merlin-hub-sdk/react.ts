'use client';

/**
 * Merlin Hub SDK v1.0.1
 * ─────────────────────────────────────────────
 * [CLIENT ONLY] 리액트 전용 엔트리
 * 이 파일은 클라이언트 컴포넌트에서만 임포트해야 합니다.
 */

// 1. Core Hooks (비즈니스 로직)
export { HubProvider, useHub } from './HubProvider';
export { useHubSession } from './Session/useHubSession';
export { useHubAuth } from './Auth/useHubAuth';
export { useHubPayment } from './Wallet/useHubPayment';
export { useHubNotifier } from './Notification/useHubNotifier';
export { useHubReferral } from './Referral/useHubReferral';

// 2. Core 로직 (클라이언트에서도 자주 쓰는 함수들)
export { 
  checkSession, 
  logout, 
  getProfile, 
  requestOTP, 
  verifyOTP,
  getBalance,
  getUserId,
  useCredit,
  MerlinHubClient
} from './CoreLogic';

// 3. Custom UI Components (표준 UI 부품)
export { HubProfileWidget, HubAvatar } from './Session/HubProfileWidget';
export { HubProfileCard, HubNotificationCard, HubLogoutCard } from './Session/HubProfileCards';
export { HubAuthModal } from './Auth/HubAuthModal';
export { HubRegisterNudge } from './UI/HubRegisterNudge';
export { HubPaymentTrigger } from './Wallet/HubPaymentTrigger';
export { HubPurchaseWidget } from './Wallet/HubPurchaseWidget';
export { HubNotifier, showToast } from './Notification/HubNotifier';
export { HubReferralWidget } from './Referral/HubReferralWidget';
export { HubHistoryList } from './Referral/HubHistoryList';
export { HubShareButton } from './Referral/HubShareButton';
export { HubShareSquare } from './Referral/HubShareSquare';
export { HubWelcomeNudge } from './UI/HubWelcomeNudge';
