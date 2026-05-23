/**
 * Version: v1.0.0
 * Last Updated: 2026-05-23
 */
import React, { useState, useEffect } from 'react';
import { useHubReferral } from './useHubReferral';

interface HubShareSquareProps {
  className?: string;
  customTitle?: string;
  customUrl?: string;
  description?: string;
}

/**
 * [Custom] 공유 스퀘어 위젯
 * 현재 페이지의 URL과 추천인 코드를 결합하여 공유 액션을 돕는 유틸리티입니다.
 */
export const HubShareSquare: React.FC<HubShareSquareProps> = ({
  className = '',
  customTitle = '이 페이지를 친구에게 공유해보세요!',
  customUrl,
  description = '공유 링크에는 내 추천인 코드가 포함되어 전달됩니다.',
}) => {
  const [pathname, setPathname] = useState('');
  const { getMyReferralInfo, isLoading } = useHubReferral();
  const [inviteCode, setInviteCode] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPathname(window.location.pathname);
      const handleLocationChange = () => {
        setPathname(window.location.pathname);
      };
      window.addEventListener('popstate', handleLocationChange);
      return () => {
        window.removeEventListener('popstate', handleLocationChange);
      };
    }
  }, []);

  useEffect(() => {
    const fetchInfo = async () => {
      const info = await getMyReferralInfo();
      if (info) setInviteCode(info.code);
    };
    fetchInfo();
  }, [getMyReferralInfo]);

  // 페이지 이동(또는 customUrl 변경) 시 복사 완료 상태 초기화
  useEffect(() => {
    setIsCopied(false);
  }, [pathname, customUrl]);

  const handleCopy = () => {
    if (typeof window === 'undefined') return;
    
    let shareUrl = '';
    const base = customUrl || window.location.href;
    
    if (inviteCode) {
      try {
        const urlObj = new URL(base);
        urlObj.searchParams.set('ref', inviteCode);
        shareUrl = urlObj.toString();
      } catch (e) {
        shareUrl = `${base}${base.includes('?') ? '&' : '?'}ref=${inviteCode}`;
      }
    } else {
      shareUrl = base;
    }
    
    // 복사될 텍스트 포맷 (제목 + 링크)
    const textToCopy = `${customTitle}\n\n${shareUrl}`;
    
    navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (isLoading && !inviteCode) {
    return <div className="w-full h-48 bg-slate-100 animate-pulse rounded-2xl" />;
  }

  return (
    <div className={`w-full bg-gradient-to-br from-indigo-600 via-blue-600 to-sky-500 rounded-2xl p-5 text-white relative overflow-hidden shadow-lg ${className}`}>
      {/* 3D 느낌의 꾸밈 요소 */}
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
      <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-indigo-900/20 blur-xl"></div>

      <div className="relative z-10 flex flex-col h-full justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold leading-snug tracking-tight line-clamp-2">
            {customTitle}
          </h3>
          <p className="text-[11px] text-blue-100 mt-2 leading-relaxed opacity-90">
            {description}
          </p>
        </div>

        <button
          onClick={handleCopy}
          className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold transition-all shadow-sm active:scale-[0.98] ${
            isCopied 
              ? 'bg-emerald-500 text-white shadow-emerald-500/20' 
              : 'bg-white text-blue-600 hover:bg-blue-50 shadow-white/10'
          }`}
        >
          {isCopied ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              복사 완료!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              링크 복사하기
            </>
          )}
        </button>
      </div>
    </div>
  );
};
