/**
 * Version: v1.0.0
 * Last Updated: 2026-05-15
 */
import { useCallback } from 'react';
import { MerlinHubClient } from '../CoreLogic/client';

/**
 * [Core] Hub 알림 시스템 연동을 담당하는 커스텀 훅
 * 허브를 통한 이메일 발송 및 유저의 알림 설정 관리를 지원합니다.
 */
export function useHubNotifier() {
  const client = new MerlinHubClient();

  /**
   * 허브를 통한 표준 이메일 발송 요청
   * @param templateId 허브에 등록된 이메일 템플릿 ID
   * @param data 템플릿에 들어갈 동적 데이터
   */
  const sendEmail = useCallback(async (templateId: string, data: any) => {
    try {
      const result = await client.sendNotification({
        type: 'email',
        templateId,
        data,
      });
      return result.success;
    } catch (err) {
      console.error('이메일 발송 실패:', err);
      return false;
    }
  }, []);

  /**
   * 앱별 알림 수신 설정 업데이트
   */
  const updateSettings = useCallback(async (settings: { email: boolean; push?: boolean }) => {
    try {
      const result = await client.updateProfile({
        notification_settings: settings,
      });
      return !!result;
    } catch (err) {
      console.error('알림 설정 업데이트 실패:', err);
      return false;
    }
  }, []);

  return {
    sendEmail,
    updateSettings,
  };
}
