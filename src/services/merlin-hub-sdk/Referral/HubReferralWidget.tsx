/**
 * Version: v1.1.0
 * Last Updated: 2026-05-16
 */
import React, { useState, useEffect } from 'react';
import { useHubReferral } from './useHubReferral';

interface HubReferralWidgetProps {
  className?: string;
  title?: string;
  description?: string;
}

/**
 * [Custom] 친구 초대(Referral) 위젯
 * 초대자(Inviter)의 코드를 노출하고 가입자(Invitee) 유치를 돕는 UI 컴포넌트입니다.
 */
export const HubReferralWidget: React.FC<HubReferralWidgetProps> = ({
  className = '',
  title = '친구 초대 보너스 🎁',
  description = '친구를 초대하고 함께 무료 코인을 받으세요!',
}) => {
  const { getMyReferralInfo, isLoading } = useHubReferral();
  const [inviteCode, setInviteCode] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    const fetchInfo = async () => {
      const info = await getMyReferralInfo();
      if (info) setInviteCode(info.code);
    };
    fetchInfo();
  }, []);

  const handleCopy = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  if (isLoading && !inviteCode) {
    return <div className="w-full h-32 bg-gray-50 animate-pulse rounded-2xl" />;
  }

  return (
    <div className={`w-full bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white relative overflow-hidden shadow-lg ${className}`}>
      {/* 배경 장식 (발바닥 아이콘 포인트) */}
      <div className="absolute -bottom-4 -right-4 opacity-10 rotate-12">
        <img src="/hub_assets/guest_paw.png" alt="" className="w-32 h-32" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <h3 className="text-xl font-bold mb-1">{title}</h3>
        <p className="text-sm text-indigo-100 mb-6">{description}</p>

        <div className="w-full bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20 flex flex-col items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-indigo-200 font-bold">내 초대 코드</span>
          <div className="flex items-center gap-3 w-full">
            <div className="flex-grow bg-white/10 rounded-lg px-4 py-3 text-2xl font-mono font-bold tracking-wider text-center border border-white/5">
              {inviteCode || '-------'}
            </div>
            <button
              onClick={handleCopy}
              className={`flex-shrink-0 px-4 py-3 rounded-lg font-bold transition-all ${
                isCopied ? 'bg-green-400 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'
              }`}
            >
              {isCopied ? '복사됨!' : '복사'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
