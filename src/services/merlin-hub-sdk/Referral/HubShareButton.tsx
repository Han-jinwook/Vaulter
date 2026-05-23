import React from 'react';

interface HubShareButtonProps {
  className?: string;
  onClick: () => void;
}

/**
 * [Referral] 친구 초대 공유 버튼
 * 클릭 시 앱 내 공유 모달(ShareModal)을 띄우거나 자체 Web Share API를 호출합니다.
 */
export const HubShareButton: React.FC<HubShareButtonProps> = ({ className = '', onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all ${className}`}
    >
      친구 초대하고 500C 받기 🎁
    </button>
  );
};
