/**
 * Version: v1.1.2
 * Last Updated: 2026-05-17
 * Merlin Hub SDK — Auth Module
 * 이메일 OTP 인증: requestOTP → verifyOTP → JWT 저장
 * 프로필 관리: updateProfile → Hub family_users 직접 갱신
 */

import { hubFetch, setSessionToken, clearSessionToken, getSessionToken } from '../CoreLogic/client';

export interface OTPRequestResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface OTPVerifyResult {
  success: boolean;
  token?: string;
  userId?: string;
  familyUid?: string;
  email?: string;
  nickname?: string;
  avatar_url?: string;
  referral_code?: string;
  error?: string;
  message?: string;
}

/**
 * OTP 인증코드 발송 요청
 * @param email 사용자 이메일
 * @param appId 앱 식별자 (예: AGGRO_FILTER)
 */
export async function requestOTP(email: string, appId?: string): Promise<OTPRequestResult> {
  try {
    const { ok, data } = await hubFetch<OTPRequestResult>('/api/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email, appId }),
    });

    if (!ok) {
      const message = (data as any)?.message;
      return { success: false, error: data?.error || message || 'OTP 발송 실패' };
    }

    return { success: true, message: data?.message || 'OTP가 발송되었습니다.' };
  } catch (err) {
    console.error('[MerlinHub] requestOTP error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * OTP 인증코드 검증 → 성공 시 JWT를 localStorage에 저장
 * @param email 사용자 이메일
 * @param code 6자리 OTP 코드
 * @param appId 앱 식별자 (예: AGGRO_FILTER)
 * @param referralCode 추천인 코드
 * @param pendingUsageFee 비회원 시절 가불된 분석 비용
 * @param pendingVideoId 비회원 시절 분석된 비디오 ID
 */
export async function verifyOTP(
  email: string, 
  code: string, 
  appId?: string, 
  referralCode?: string,
  pendingUsageFee?: number,
  pendingVideoId?: string
): Promise<OTPVerifyResult> {
  try {
    const { ok, data } = await hubFetch<OTPVerifyResult>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code, appId, referralCode, pendingUsageFee, pendingVideoId }),
    });

    if (!ok) {
      const message = (data as any)?.message;
      return { success: false, error: data?.error || message || '인증 실패' };
    }

    // JWT 토큰 저장
    if (data.token) {
      setSessionToken(data.token);
    }

    const resolvedUserId = data.userId || data.familyUid;

    // 데이터 저장 (지갑 및 UI에서 참조)
    if (typeof window !== 'undefined') {
      if (resolvedUserId) {
        localStorage.setItem('merlin_user_id', resolvedUserId);
        localStorage.setItem('merlin_family_uid', resolvedUserId);
      }
      if (data.referral_code) {
        localStorage.setItem('userReferralCode', data.referral_code);
      }
    }

    return {
      success: true,
      token: data.token,
      userId: resolvedUserId,
      familyUid: data.familyUid,
      email: data.email || email,
      nickname: data.nickname,
      avatar_url: data.avatar_url,
      referral_code: data.referral_code
    };
  } catch (err) {
    console.error('[MerlinHub] verifyOTP error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

export interface SessionResult {
  valid: boolean;
  email?: string;
  userId?: string;
  nickname?: string;
  avatar_url?: string;
  referral_code?: string;
}

/**
 * 현재 세션이 유효한지 확인
 */
export async function checkSession(): Promise<SessionResult> {
  const token = getSessionToken();
  if (!token) return { valid: false };

  try {
    const timestamp = Date.now();
    const { ok, data } = await hubFetch<{ success: boolean; user: any }>(`/api/auth/me?t=${timestamp}`);
    if (!ok || !data.success) {
      clearSessionToken();
      return { valid: false };
    }
    const u = data.user;
    
    // UI 동기화를 위해 추천 코드 저장
    if (u.referral_code && typeof window !== 'undefined') {
      localStorage.setItem('userReferralCode', u.referral_code);
    }

    return { 
      valid: true, 
      email: u.email, 
      userId: u.userId || u.id,
      nickname: u.nickname,
      avatar_url: u.avatar_url,
      referral_code: u.referral_code
    };
  } catch {
    return { valid: false };
  }
}

// ── 프로필 관리 (Hub SSOT) ──

export interface ProfileUpdateParams {
  nickname?: string;
  avatar_url?: string;
}

export interface ProfileResult {
  success: boolean;
  nickname?: string;
  avatar_url?: string;
  profile_image?: string; // 허브에서 profile_image로 반환할 경우 대비
  referral_code?: string;
  invite_count?: number;
  total_referral_reward?: number;
  credits?: number;
  error?: string;
}

/**
 * Hub family_users에 프로필 정보 갱신
 * Endpoint: PUT /api/auth/profile
 */
export async function updateProfile(params: ProfileUpdateParams): Promise<ProfileResult> {
  try {
    const { ok, data } = await hubFetch<ProfileResult>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(params),
    });

    if (!ok) {
      return { success: false, error: data?.error || '프로필 업데이트 실패' };
    }

    return {
      success: true,
      nickname: data.nickname,
      avatar_url: data.avatar_url || data.profile_image,
    };
  } catch (err) {
    console.error('[MerlinHub] updateProfile error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * Hub에서 현재 유저 프로필 조회 (세션 토큰 기반)
 * 2026-04-23: /api/auth/me를 통해 최신 프로필까지 함께 가져옴
 */
export async function getProfile(): Promise<ProfileResult> {
  try {
    const session = await checkSession();
    if (!session.valid) {
      return { success: false, error: '세션이 유효하지 않습니다.' };
    }

    return {
      success: true,
      nickname: session.nickname,
      avatar_url: session.avatar_url,
      referral_code: session.referral_code
    };
  } catch (err) {
    console.error('[MerlinHub] getProfile error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * 로그아웃 — 세션 토큰 삭제
 */
export function logout() {
  clearSessionToken();
  if (typeof window !== 'undefined') {
    localStorage.removeItem('merlin_user_id');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userId');
    localStorage.removeItem('userNickname');
    localStorage.removeItem('userProfileImage');
  }
}
