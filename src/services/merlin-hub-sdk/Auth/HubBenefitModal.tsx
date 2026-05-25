import React from 'react';
import { useBenefitTrigger } from './useBenefitTrigger';

interface HubBenefitModalProps {
  customBenefitTitle?: string;
  customBenefitDesc?: string;
  customBenefitIcon?: string;
  onConfirm?: () => void; // 이메일 등록하기 버튼 클릭 시 동작 (ex: openLoginModal)
}

export const HubBenefitModal: React.FC<HubBenefitModalProps> = ({
  customBenefitTitle = "관심 항목 변동 알림",
  customBenefitDesc = "관심 항목이 변경되면 바로 알려드려요",
  customBenefitIcon = "🔔",
  onConfirm,
}) => {
  const { shouldShow, closeBenefitModal } = useBenefitTrigger();

  if (!shouldShow) return null;

  const handleConfirm = () => {
    closeBenefitModal();
    if (onConfirm) {
      onConfirm();
    } else {
      // 기본 동작: 로그인 모달 열기 이벤트 발생
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('openLoginModal'));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-5 animate-in zoom-in duration-300">
        <div className="text-center">
          <div className="text-3xl mb-2">🎁</div>
          <h2 className="text-lg font-bold text-gray-900">이메일 등록하면 이런 게 좋아요!</h2>
        </div>
        <ul className="space-y-4">
          <li className="flex items-start gap-3">
            <span className="text-xl">📱</span>
            <div>
              <div className="text-sm font-semibold text-gray-800">PC · 모바일 어디서든</div>
              <div className="text-xs text-gray-500">로그인만 하면 모든 기기에서 동일하게</div>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-xl">{customBenefitIcon}</span>
            <div>
              <div className="text-sm font-semibold text-gray-800">{customBenefitTitle}</div>
              <div className="text-xs text-gray-500">{customBenefitDesc}</div>
            </div>
          </li>
        </ul>
        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={handleConfirm}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors"
          >
            이메일 등록하기
          </button>
          <button
            onClick={closeBenefitModal}
            className="w-full py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            다음에 할게요
          </button>
        </div>
      </div>
    </div>
  );
};
