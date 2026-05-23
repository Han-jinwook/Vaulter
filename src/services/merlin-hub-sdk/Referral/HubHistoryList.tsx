import React from 'react';

interface HistoryItem {
  id: string;
  inviteeNickname: string;
  joinedAt: string;
  status: 'PENDING' | 'REWARDED';
}

interface HubHistoryListProps {
  className?: string;
  history?: HistoryItem[];
  isLoading?: boolean;
}

/**
 * [Referral] 초대 실적 리스트
 * 내가 초대한 친구들의 목록과 각각의 보상 지급 상태를 보여주는 컴포넌트입니다.
 */
export const HubHistoryList: React.FC<HubHistoryListProps> = ({ 
  className = '', 
  history = [], 
  isLoading = false 
}) => {
  if (isLoading) {
    return <div className="w-full h-40 bg-gray-50 animate-pulse rounded-2xl" />;
  }

  return (
    <div className={`w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>
      <h3 className="text-lg font-bold text-gray-900 mb-4">초대 실적 현황</h3>
      
      {history.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-xl">
          아직 초대한 친구가 없습니다.<br/>
          친구를 초대하고 함께 혜택을 받아보세요!
        </div>
      ) : (
        <ul className="space-y-3">
          {history.map(item => (
            <li key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
              <div>
                <p className="font-semibold text-gray-800">{item.inviteeNickname} 님</p>
                <p className="text-xs text-gray-500">{item.joinedAt} 가입</p>
              </div>
              <div>
                {item.status === 'REWARDED' ? (
                  <span className="px-2.5 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                    지급 완료
                  </span>
                ) : (
                  <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-xs font-bold rounded-full">
                    대기 중 (조건 미달성)
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
