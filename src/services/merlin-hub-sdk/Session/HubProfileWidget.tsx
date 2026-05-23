'use client';

/**
 * Version: v1.2.0
 * Last Updated: 2026-05-17
 * Description: 3D 곰발바닥 테마 글로벌 통합 및 HubAvatar 분리형 아바타 컴포넌트 추가
 */
import React from 'react';
import { useHub } from '../HubProvider';

interface HubAvatarProps {
  avatarUrl?: string;
  nickname?: string;
  isLoggedIn?: boolean;
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * [Custom] 허브 공통 아바타 컴포넌트 (HubAvatar v1.2)
 * 사장님이 고르신 '발바닥 게스트' 테마와 입체 살구색 배경을 공통 렌더링하는 표준 아바타 부품입니다.
 */
export const HubAvatar: React.FC<HubAvatarProps> = ({
  avatarUrl,
  nickname,
  isLoggedIn = true,
  size = 'sm',
  className = '',
}) => {
  const sizeClasses = size === 'lg' ? 'w-20 h-20 rounded-full' : 'w-10 h-10 rounded-2xl';
  const textClass = size === 'lg' ? 'text-3xl' : 'text-base';

  // 비로그인 상태 (게스트)
  if (!isLoggedIn) {
    return (
      <div className={`flex items-center justify-center overflow-hidden bg-orange-50 ${sizeClasses} ${className}`}>
        <img 
          src="/hub_assets/guest_paw.png" 
          alt="Guest" 
          className={`w-full h-full object-contain ${size === 'lg' ? 'rounded-full' : 'rounded-2xl'}`}
        />
      </div>
    );
  }

  const displayId = nickname || '회원';
  const firstChar = displayId.charAt(0).toUpperCase();

  return (
    <div 
      className={`flex items-center justify-center overflow-hidden bg-orange-50 ${sizeClasses} ${className}`}
      style={
        !avatarUrl
          ? { backgroundImage: 'url("/hub_assets/guest_paw_bg.png")', backgroundSize: 'cover' }
          : {}
      }
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={nickname} className="w-full h-full object-cover" />
      ) : (
        <span 
          className={`font-bold ${textClass}`}
          style={{
            color: '#7b726d', // 곰발바닥의 짙은 회색 테두리 색상
            textShadow: '-1px -1px 0px rgba(255, 255, 255, 0.8), 1px 1px 1px rgba(0, 0, 0, 0.25)', // 3D 점토 엠보싱 효과
          }}
        >
          {firstChar}
        </span>
      )}
    </div>
  );
};

interface HubProfileWidgetProps {
  onLoginClick?: () => void;
  onProfileClick?: () => void;
  className?: string;
  showNickname?: boolean;
  variant?: 'paw' | 'standard'; // 하위 호환성용
}

/**
 * [Custom] 허브 프로필 위젯 (Premium v1.2)
 * 헤더용 프로필 위젯이며 내부적으로 공통 HubAvatar를 재사용합니다.
 */
export const HubProfileWidget: React.FC<HubProfileWidgetProps> = ({
  onLoginClick,
  onProfileClick,
  className = '',
  showNickname = true,
}) => {
  const { isLoggedIn, isLoading, user } = useHub();

  // 로딩 상태 (스켈레톤)
  if (isLoading) {
    return (
      <div className={`flex flex-col items-center gap-1.5 animate-pulse ${className}`}>
        <div className="w-10 h-10 rounded-2xl bg-slate-100" />
        {showNickname && <div className="w-10 h-2 bg-slate-50 rounded-full" />}
      </div>
    );
  }

  // 비로그인 상태 (게스트)
  if (!isLoggedIn) {
    return (
      <button
        onClick={onLoginClick}
        className={`flex flex-col items-center gap-1 group hover:opacity-80 transition-all ${className}`}
      >
        <HubAvatar isLoggedIn={false} className="group-hover:scale-105 transition-transform" />
        {showNickname && (
          <span className="text-[10px] font-bold text-slate-400 group-hover:text-blue-600 transition-colors">게스트</span>
        )}
      </button>
    );
  }

  // 로그인 상태 (회원 프로필)
  const displayId = user?.nickname || user?.email?.split('@')[0] || '회원';

  return (
    <button
      onClick={onProfileClick}
      className={`flex flex-col items-center gap-1 group hover:opacity-80 transition-all ${className}`}
    >
      <HubAvatar 
        isLoggedIn={true} 
        avatarUrl={user?.avatar_url} 
        nickname={displayId} 
        className="group-hover:scale-105 transition-transform" 
      />
      {showNickname && (
        <span className="text-xs font-semibold text-gray-700 group-hover:text-blue-600">
          {displayId}
        </span>
      )}
    </button>
  );
};
