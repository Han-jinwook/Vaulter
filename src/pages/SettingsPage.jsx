import { useNavigate } from 'react-router-dom'
import { HubProfileCard, HubNotificationCard, HubLogoutCard } from '../services/merlin-hub-sdk/react'

export default function SettingsPage() {
  const navigate = useNavigate()

  return (
    <div className="-mx-4 md:-mx-8 px-4 md:px-8 py-6 min-h-full space-y-6 bg-surface text-on-surface animate-fade-in">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="mb-2">
          <p className="text-xs text-[#595959] font-bold tracking-widest uppercase">설정</p>
          <h1 className="text-3xl md:text-4xl font-extrabold mt-1 text-slate-900">프로필 및 알림</h1>
          <p className="text-xs text-[#595959] mt-2">
            볼트 서비스의 계정 정보와 허브 공통 설정을 한곳에서 안전하게 관리합니다.
          </p>
        </div>

        <div className="space-y-6">
          {/* 1. 프로필 관리 카드 */}
          <HubProfileCard onSuccess={(nickname) => console.log('Profile updated', nickname)} />

          {/* 2. 알림 설정 카드 */}
          <HubNotificationCard />

          {/* 3. 계정 로그아웃 카드 */}
          <HubLogoutCard onLogout={() => navigate('/')} />
        </div>
      </div>
    </div>
  )
}
