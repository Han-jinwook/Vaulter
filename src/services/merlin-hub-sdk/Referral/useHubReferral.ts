/**
 * Version: v1.1.0
 * Last Updated: 2026-05-16
 */
import { useState, useCallback } from 'react';
import { MerlinHubClient } from '../CoreLogic/client';

/**
 * [Core] Hub 초대 시스템(Referral) 및 보상 연동을 담당하는 커스텀 훅
 * 초대자(Inviter)와 가입자(Invitee) 간의 연결 및 보상 정보를 관리합니다.
 */
export function useHubReferral() {
  const [isLoading, setIsLoading] = useState(false);
  const client = new MerlinHubClient();

  /**
   * 나의 초대 정보 조회 (초대자 관점)
   * @returns { code: 초대코드, inviteCount: 초대한 가입자 수, totalReward: 누적 보상 }
   */
  const getMyReferralInfo = useCallback(async () => {
    try {
      setIsLoading(true);
      const profile = await client.getProfile();
      return {
        code: profile?.referral_code || '',
        inviteCount: profile?.invite_count || 0,
        totalReward: profile?.total_referral_reward || 0,
      };
    } catch (err) {
      console.error('[MerlinHub] 초대 정보 조회 실패:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 가입 시 초대자 코드 등록 (가입자 관점)
   * @param code 초대자(Inviter)의 고유 코드
   */
  const registerInviter = useCallback(async (code: string) => {
    try {
      setIsLoading(true);
      // 서버의 초대자 등록 API 호출 (내부적으로 보상 프로세스 진행)
      const result = await client.registerReferrer(code);
      return result.success;
    } catch (err) {
      console.error('[MerlinHub] 초대자 등록 실패:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * 나의 초대 실적 목록 조회
   */
  const getReferralHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      return await client.getReferrals();
    } catch (err) {
      console.error('[MerlinHub] 초대 실적 목록 조회 실패:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    getMyReferralInfo,
    registerInviter,
    getReferralHistory,
    // [Alias] 가시성을 위해 명칭 제공
    registerInviteeFlow: registerInviter 
  };
}
