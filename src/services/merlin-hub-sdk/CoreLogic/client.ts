/**
 * Version: v1.1.0
 * Last Updated: 2026-05-16
 * Merlin Hub SDK — HTTP Client
 * - 모든 허브 통신에 CLIENT_ID/SECRET 헤더를 자동 부착
 * - 네트워크 실패 시 지수 백오프 재시도 (최대 3회)
 * - JWT 401 만료 감지 → 자동 세션 클리어 + 이벤트 발행
 */

import { getConfig } from './config';

const SESSION_TOKEN_KEY = 'merlin_session_token';
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

// KCP 심사관용 테스트 세션 식별자
export const TEST_SESSION_TOKEN = 'test-session-token';
export const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_EMAIL = 'test@aggrofilter.com';
export const TEST_NICKNAME = 'KCP심사관';

/** 현재 localStorage 세션이 KCP 심사용 테스트 세션인지 (사용 안 함 - 정석대로 허브 호출하도록 수정) */
export function isTestSession(): boolean {
  return false;
}

// ── 세션 토큰 관리 ──

export function getSessionToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

/**
 * JWT가 만료(exp) 임박한지 확인 — 만료 60초 전부터 true
 */
export function isTokenExpired(): boolean {
  const token = getSessionToken();
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 60_000;
  } catch {
    return true;
  }
}

// ── 재시도 유틸 ──

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── 핵심 Fetch ──

export interface HubFetchResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

async function getTestSessionMock<T>(path: string, options: RequestInit): Promise<HubFetchResult<T> | null> {
  if (!isTestSession()) return null;

  const method = (options.method || 'GET').toUpperCase();

  // /api/auth/me — 세션 검증
  if (path === '/api/auth/me') {
    return {
      ok: true,
      status: 200,
      data: {
        success: true,
        user: {
          email: TEST_EMAIL,
          userId: TEST_USER_ID,
          id: TEST_USER_ID,
          nickname: TEST_NICKNAME,
          avatar_url: '',
        },
      } as T,
    };
  }

  // /api/wallet/balance — 로컬 잔액 동기화
  if (path.startsWith('/api/wallet/balance')) {
    try {
      // 심사관의 실제 로컬 크레딧을 가져온다 (9999 고정 아님)
      const res = await fetch(`/api/user/credits?userId=${TEST_USER_ID}`, { cache: 'no-store' });
      const data = await res.json();
      return {
        ok: true,
        status: 200,
        data: { balance: typeof data.credits === 'number' ? data.credits : 0, userId: TEST_USER_ID } as T,
      };
    } catch {
      return {
        ok: true,
        status: 200,
        data: { balance: 0, userId: TEST_USER_ID } as T,
      };
    }
  }

  // /api/wallet/history — 이용 내역 (로컬 API가 이미 Hub 연동형으로 바뀌었으므로, 직접 호출 시에도 로컬 연동 유지)
  if (path.startsWith('/api/wallet/history')) {
    try {
      const res = await fetch(`/api/user/credit-history?userId=${TEST_USER_ID}`, { cache: 'no-store' });
      const data = await res.json();
      return {
        ok: true,
        status: 200,
        data: {
          history: data,
          app_id: getConfig().appId || 'DEFAULT_APP'
        } as T,
      };
    } catch {
      return { ok: true, status: 200, data: { history: [] } as T };
    }
  }

  // /api/wallet/use 또는 /api/wallet/transaction/dynamic — 차감
  if ((path === '/api/wallet/use' || path.startsWith('/api/wallet/transaction')) && method === 'POST') {
    // 테스트 세션에서는 실제 차감 대신 성공 응답만 반환 (또는 필요시 로컬 API 호출)
    return {
      ok: true,
      status: 200,
      data: { success: true, balance: 9999 } as T,
    };
  }

  // /api/auth/profile — 프로필 갱신
  if (path === '/api/auth/profile') {
    return {
      ok: true,
      status: 200,
      data: {
        success: true,
        nickname: TEST_NICKNAME,
        avatar_url: '',
      } as T,
    };
  }

  // 그 외 허브 API (결제 관련 /api/payment 등은 실제 서버로 통과시킴)
  return null;
}

export async function hubFetch<T = any>(
  path: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<HubFetchResult<T>> {
  // KCP 심사관 테스트 세션 차단 — 허브 호출 우회
  const mock = await getTestSessionMock<T>(path, options);
  if (mock) return mock;

  const config = getConfig();
  const url = `${config.hubUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': config.clientId,
    'X-Client-Secret': config.clientSecret,
    ...(options.headers as Record<string, string> || {}),
  };

  // 세션 토큰이 있으면 Authorization 헤더 추가
  const token = getSessionToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));

      // 401 → JWT 만료 — 세션 클리어 후 이벤트 발행
      if (res.status === 401) {
        clearSessionToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('merlinSessionExpired'));
        }
        return { ok: false, status: 401, data: data as T };
      }

      // 5xx 서버 오류 → 재시도 대상
      if (res.status >= 500 && attempt < retries - 1) {
        await wait(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      return { ok: res.ok, status: res.status, data: data as T };
    } catch (err) {
      lastError = err as Error;
      // 네트워크 오류(ECONNREFUSED 등) → 재시도
      if (attempt < retries - 1) {
        await wait(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
    }
  }

  console.error('[MerlinHub] hubFetch failed after retries:', path, lastError);
  return { ok: false, status: 0, data: { error: '허브 서버 연결 실패' } as any };
}

/**
 * [Compatibility] 클래스 기반 SDK 클라이언트
 * 기존 컴포넌트들과의 호환성을 위해 유지합니다.
 */
export class MerlinHubClient {
  async getProfile() {
    const { getProfile } = await import('../Auth/auth');
    return getProfile();
  }

  async sendOtp(email: string) {
    // 앱별 인증 컨텍스트를 주입하여 인증 메일을 올바르게 전송합니다
    const { requestOTP } = await import('../Auth/auth');
    const { getConfig } = await import('./config');
    return requestOTP(email, getConfig().appId);
  }

  async verifyOtp(email: string, code: string) {
    const { verifyOTP } = await import('../Auth/auth');
    const { getConfig } = await import('./config');
    
    // 로컬스토리지에서 초대코드 조회 후 파라미터 전달
    let referralCode = undefined;
    if (typeof window !== 'undefined') {
      referralCode = localStorage.getItem('userReferralCode') || undefined;
    }
    return verifyOTP(email, code, getConfig().appId, referralCode);
  }

  async preparePayment(params: {
    amount: number;
    coinAmount: number;
    payMethodType: 'card' | 'phone';
    returnUrl: string;
  }) {
    const { requestKcpPayment } = await import('../Wallet/wallet');
    return requestKcpPayment(params);
  }

  async sendNotification(params: any) {
    console.log('[MerlinHubClient] Notification requested:', params);
    return { success: true };
  }

  async updateProfile(params: any) {
    const { updateProfile } = await import('../Auth/auth');
    return updateProfile(params);
  }

  async registerReferrer(code: string) {
    // 임시 구현: 실제 구현 시에는 auth.ts에 별도 함수를 만들거나 서버 호출
    console.log('[MerlinHubClient] registerReferrer requested:', code);
    return { success: true };
  }

  async getReferrals() {
    const res = await hubFetch<{ success: boolean; referrals: any[] }>('/api/auth/referrals');
    if (res.ok && res.data.success) {
      return res.data.referrals;
    }
    return [];
  }
}
