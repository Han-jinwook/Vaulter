'use client';

/**
 * Version: v1.0.1 (Bug Fixes)
 * Last Updated: 2026-05-15
 */
import { useState, useEffect } from 'react';
import { MerlinHubClient } from '../CoreLogic/client';

export interface HubSession {
  isLoggedIn: boolean;
  isLoading: boolean;
  user: {
    id: string;
    email?: string;
    nickname?: string;
    avatar_url?: string;
    credits?: number;
  } | null;
  error: Error | null;
}

/**
 * [Core] Hub 세션 상태를 관리하는 커스텀 훅
 */
export function useHubSession() {
  const [session, setSession] = useState<HubSession>({
    isLoggedIn: false,
    isLoading: true,
    user: null,
    error: null,
  });

  const client = new MerlinHubClient();

  const refreshSession = async () => {
    try {
      setSession(prev => ({ ...prev, isLoading: true }));
      
      const profile = await client.getProfile();
      
      // [FIX] profile 객체 존재 여부뿐만 아니라 success 필드까지 확인해야 함
      if (profile && profile.success) {
        setSession({
          isLoggedIn: true,
          isLoading: false,
          user: profile as any,
          error: null,
        });
      } else {
        setSession({
          isLoggedIn: false,
          isLoading: false,
          user: null,
          error: null,
        });
      }
    } catch (err: any) {
      setSession({
        isLoggedIn: false,
        isLoading: false,
        user: null,
        error: err,
      });
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  return {
    ...session,
    refreshSession,
  };
}
