'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { checkSession, getBalance, getUserId } from './CoreLogic/index';
import { configureMerlinHub } from './CoreLogic/config';

interface HubUser {
  id: string;
  email: string;
  nickname?: string;
  avatar_url?: string;
}

interface HubContextType {
  user: HubUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  balance: number | null;
  refreshSession: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const HubContext = createContext<HubContextType | undefined>(undefined);

export function HubProvider({ children, appId }: { children: React.ReactNode; appId?: string }) {
  const [user, setUser] = useState<HubUser | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);

  // appId 설정 주입
  useEffect(() => {
    if (appId) {
      configureMerlinHub({ appId });
    }
  }, [appId]);

  const refreshBalance = useCallback(async () => {
    try {
      const userId = getUserId();
      if (!userId) return;
      
      const result = await getBalance(userId);
      if (result.success && typeof result.balance === 'number') {
        setBalance(result.balance);
      }
    } catch (err) {
      console.error('[HubProvider] Failed to fetch balance:', err);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      setIsLoading(true);
      const session = await checkSession();
      
      if (session.valid && session.email) {
        setUser({
          id: session.userId || '',
          email: session.email,
          nickname: session.nickname,
          avatar_url: session.avatar_url,
        });
        setIsLoggedIn(true);
        // 세션 확인 성공 시 잔액도 업데이트
        refreshBalance();
      } else {
        setUser(null);
        setIsLoggedIn(false);
        setBalance(null);
      }
    } catch (err) {
      console.error('[HubProvider] Failed to sync session:', err);
    } finally {
      setIsLoading(false);
    }
  }, [refreshBalance]);

  // 초기 로드 및 이벤트 리스너
  useEffect(() => {
    refreshSession();

    // 외부 이벤트 대응 (로그인 성공, 세션 만료, 잔액 변동 등)
    const handleProfileUpdate = () => refreshSession();
    const handleCreditsUpdate = () => refreshBalance();
    const handleSessionExpired = () => {
      setUser(null);
      setIsLoggedIn(false);
      setBalance(null);
    };

    window.addEventListener('profileUpdated', handleProfileUpdate);
    window.addEventListener('creditsUpdated', handleCreditsUpdate);
    window.addEventListener('merlinSessionExpired', handleSessionExpired);

    return () => {
      window.removeEventListener('profileUpdated', handleProfileUpdate);
      window.removeEventListener('creditsUpdated', handleCreditsUpdate);
      window.removeEventListener('merlinSessionExpired', handleSessionExpired);
    };
  }, [refreshSession, refreshBalance]);

  return (
    <HubContext.Provider value={{ 
      user, 
      isLoggedIn, 
      isLoading, 
      balance, 
      refreshSession, 
      refreshBalance 
    }}>
      {children}
    </HubContext.Provider>
  );
}

export function useHub() {
  const context = useContext(HubContext);
  if (context === undefined) {
    throw new Error('useHub must be used within a HubProvider');
  }
  return context;
}
