/**
 * Merlin Hub SDK v1.1.0
 * ─────────────────────────────────────────────
 * [SERVER SAFE] 공통 및 서버 전용 엔트리
 * 이 파일은 서버 컴포넌트 및 API Route에서도 안전하게 임포트할 수 있습니다.
 */

// 1. 핵심 설정 및 클라이언트
export { MerlinHub, configureMerlinHub, getConfig } from './CoreLogic/index';
export { 
  hubFetch, 
  getSessionToken, 
  setSessionToken, 
  clearSessionToken, 
  isTokenExpired,
  MerlinHubClient
} from './CoreLogic/client';

// 2. 인증 및 세션 (서버에서도 쓰이는 함수들)
export { 
  requestOTP, 
  verifyOTP, 
  checkSession, 
  logout, 
  updateProfile, 
  getProfile 
} from './Auth/auth';

// 3. 지갑 및 과금 (서버 API Route에서 필수)
export { 
  getBalance, 
  getUserId, 
  useCredit, 
  getPricing, 
  processTransaction, 
  chargeDynamic, 
  getHistory,
  requestKcpPayment 
} from './Wallet/wallet';
