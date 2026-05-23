/**
 * Version: v1.0.0
 * Last Updated: 2026-05-15
 */
import React from 'react';
import { useHubSession } from '../Session/useHubSession';

interface HubRegisterNudgeProps {
  onRegisterClick?: () => void;
  appName?: string;
  appLogoUrl?: string;
  benefits?: string[];
  className?: string;
  backgroundColor?: string;
}

/**
 * [Custom] 가입 권유 넛지 카드
 * 게스트 유저에게 회원가입의 혜택을 알리고 인증으로 유도하는 컴포넌트입니다.
 */
export const HubRegisterNudge: React.FC<HubRegisterNudgeProps> = ({
  onRegisterClick,
  appName = '앱',
  appLogoUrl = '/hub_assets/guest_paw.png',
  benefits = ['기록 보존', '알림 수신', '기기 변경 시 데이터 유지'],
  className = '',
  backgroundColor = 'bg-blue-50',
}) => {
  const { isLoggedIn, isLoading } = useHubSession();

  // 이미 로그인했거나 로딩 중이면 보여주지 않음
  if (isLoading || isLoggedIn) return null;

  return (
    <button
      onClick={onRegisterClick}
      className={`w-full flex items-center p-4 rounded-xl gap-4 transition-all hover:scale-[1.01] active:scale-[0.99] group border border-transparent hover:border-blue-200 ${backgroundColor} ${className}`}
    >
      {/* 앱 로고 / 아이콘 */}
      <div className="w-10 h-10 flex-shrink-0 bg-white rounded-lg p-1.5 shadow-sm overflow-hidden flex items-center justify-center">
        <img src={appLogoUrl} alt={appName} className="w-full h-full object-contain" />
      </div>

      {/* 안내 텍스트 */}
      <div className="flex flex-col items-start flex-grow text-left">
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold text-blue-700">이메일을 등록해봐요!</span>
          <span className="text-sm">😊</span>
        </div>
        <p className="text-xs text-blue-500/80 font-medium">
          {benefits.join(' · ')}
        </p>
      </div>

      {/* 화살표 아이콘 */}
      <div className="text-blue-300 group-hover:text-blue-600 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </div>
    </button>
  );
};
