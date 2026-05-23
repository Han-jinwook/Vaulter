/**
 * Version: v1.1.0
 * Last Updated: 2026-05-19
 */
import React from 'react';
import { useHubPayment } from './useHubPayment';

interface HubPaymentTriggerProps {
  amount: number;
  coinAmount: number;
  payMethodType?: 'card' | 'phone' | 'bank';
  returnUrl?: string;
  label?: string;
  className?: string;
  onSuccess?: () => void;
  onError?: (error: string) => void;
  children?: React.ReactNode;
}

/**
 * [Custom] 허브 결제 실행 트리거
 * 클릭 시 허브의 KCP 결제창을 호출하는 표준 버튼 컴포넌트입니다.
 */
export const HubPaymentTrigger: React.FC<HubPaymentTriggerProps> = ({
  amount,
  coinAmount,
  payMethodType = 'card',
  returnUrl,
  label = '결제하기',
  className = '',
  onSuccess,
  onError,
  children,
}) => {
  const { status, requestPayment, error } = useHubPayment();

  const handlePayment = async () => {
    const success = await requestPayment({
      amount,
      coinAmount,
      payMethodType,
      returnUrl
    });
    
    if (success && onSuccess) {
      onSuccess();
    } else if (error && onError) {
      onError(error);
    }
  };

  const isLoading = status === 'preparing' || status === 'pending';

  return (
    <div className="flex flex-col gap-2 w-full">
      <button
        onClick={handlePayment}
        disabled={isLoading}
        className={`
          relative flex items-center justify-center py-4 px-6 rounded-2xl font-bold text-lg transition-all
          ${isLoading ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]'}
          ${className}
        `}
      >
        {isLoading ? (
          <div className="flex items-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>준비 중...</span>
          </div>
        ) : (
          children || label
        )}
      </button>
      
      {error && !onError && (
        <p className="text-red-500 text-xs text-center font-medium animate-bounce">
          ⚠️ {error}
        </p>
      )}
    </div>
  );
};
