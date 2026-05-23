/**
 * Version: v1.1.0
 * Last Updated: 2026-05-16
 */
import { useState, useEffect, useCallback } from 'react';
import { MerlinHubClient } from '../CoreLogic/client';

export type AuthStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'success' | 'error';

/**
 * [Core] Hub 이메일 인증 로직을 관리하는 커스텀 훅
 * OTP 발송, 타이머, 코드 검증의 모든 복잡한 상태를 이 훅이 전담합니다.
 */
export function useHubAuth() {
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [email, setEmail] = useState('');
  const [timer, setTimer] = useState(0); // 초 단위 타이머
  const [error, setError] = useState<string | null>(null);
  
  const client = new MerlinHubClient();

  // 타이머 로직
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timer > 0 && status === 'sent') {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0) {
      // @ts-ignore
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [timer, status]);

  /**
   * 인증 코드(OTP) 발송 요청
   */
  const sendOtp = useCallback(async (targetEmail: string) => {
    try {
      setStatus('sending');
      setError(null);
      setEmail(targetEmail);

      const result = await client.sendOtp(targetEmail);
      
      if (result.success) {
        setStatus('sent');
        setTimer(180); // 3분 타이머 시작
      } else {
        throw new Error(result.message || 'OTP 발송에 실패했습니다.');
      }
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
    }
  }, []);

  /**
   * 인증 코드 검증 요청
   */
  const verifyOtp = useCallback(async (code: string) => {
    try {
      setStatus('verifying');
      setError(null);

      const result = await client.verifyOtp(email, code);
      
      if (result.success) {
        setStatus('success');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('profileUpdated'));
        }
        // 인증 성공 시 세션 동기화를 위해 약간의 지연 후 성공 처리
        return true;
      } else {
        throw new Error(result.message || '인증 코드가 일치하지 않습니다.');
      }
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
      return false;
    }
  }, [email]);

  /**
   * 상태 초기화 (재시도 등)
   */
  const reset = useCallback(() => {
    setStatus('idle');
    setTimer(0);
    setError(null);
  }, []);

  // 타이머 포맷팅 (03:00 형식)
  const formatTimer = () => {
    const mm = Math.floor(timer / 60).toString().padStart(2, '0');
    const ss = (timer % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  return {
    status,
    email,
    timer,
    formatTimer,
    error,
    sendOtp,
    verifyOtp,
    reset,
  };
}
