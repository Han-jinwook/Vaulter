import React from 'react';

interface HubWelcomeNudgeProps {
  className?: string;
}

/**
 * [UI] 초대 가입 축하 넛지
 * 초대 링크로 가입한 직후 사용자에게 보상(500C) 획득 조건을 안내하는 컴포넌트입니다.
 */
export const HubWelcomeNudge: React.FC<HubWelcomeNudgeProps> = ({ className = '' }) => {
  return (
    <div className={`p-4 bg-orange-50 border border-orange-200 rounded-xl flex items-start gap-3 ${className}`}>
      <div className="text-2xl mt-1">🎉</div>
      <div>
        <h4 className="font-bold text-orange-900 mb-1">가입을 축하합니다!</h4>
        <p className="text-sm text-orange-800">
          첫 기능을 사용(예: 분석 1회 완료)하시면 회원님과 초대해 주신 친구분 모두에게 <strong>500C</strong>가 지급됩니다!
        </p>
      </div>
    </div>
  );
};
