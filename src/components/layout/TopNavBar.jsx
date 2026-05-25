import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { HubProfileWidget, HubAuthModal } from '../../services/merlin-hub-sdk/react'

const navItems = [
  { path: '/', desktopLabel: '지기(Keeper)', mobileLabel: '지기' },
  { path: '/assets', desktopLabel: '황금자산', mobileLabel: '자산' },
  { path: '/vault', desktopLabel: '비밀금고', mobileLabel: '금고' },
]

export default function TopNavBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    isHubAuthModalOpen,
    openHubAuthModal,
    closeHubAuthModal,
  } = useUIStore()

  const isActive = (path) => location.pathname === path

  useEffect(() => {
    const handleOpenLoginModal = () => {
      openHubAuthModal()
    }
    window.addEventListener('openLoginModal', handleOpenLoginModal)
    return () => {
      window.removeEventListener('openLoginModal', handleOpenLoginModal)
    }
  }, [openHubAuthModal])

  return (
    <header className="sticky top-0 z-50 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <HubAuthModal
        isOpen={isHubAuthModalOpen}
        onClose={closeHubAuthModal}
        appName="금고지기"
        appLogoUrl="/logo.png"
        onSuccess={() => {
          setTimeout(() => {
            closeHubAuthModal()
          }, 1500)
        }}
      />
      <div className="w-full max-w-[1680px] mx-auto">
        <div className="flex justify-between items-center px-3 md:px-5 h-14 md:h-16">
          {/* Left: Logo + Desktop Nav */}
          <div className="flex items-center gap-3 md:gap-5 min-w-0">
            <Link to="/" className="shrink-0 flex items-center">
              <img src="/logo.png" alt="금고지기" className="h-10 md:h-12 object-contain" />
            </Link>
            <nav className="hidden md:flex items-center gap-4 text-sm font-medium tracking-tight">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={
                    isActive(item.path)
                      ? 'text-primary border-primary font-bold border-b-2 pb-1'
                      : 'text-on-surface-variant hover:text-primary transition-colors duration-200'
                  }
                >
                  <span className="hidden md:inline">{item.desktopLabel}</span>
                  <span className="md:hidden">{item.mobileLabel}</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
            <button className="p-2 rounded-full transition-all active:scale-95 text-on-surface-variant hover:bg-primary/10">
              <span className="material-symbols-outlined">notifications</span>
            </button>

            {/* 허브 통합 프로필 위젯 */}
            <HubProfileWidget 
              onLoginClick={openHubAuthModal}
              onProfileClick={() => navigate('/p-settings')}
              showNickname={false}
              className="ml-1"
            />
          </div>
        </div>

        {/* Mobile Nav */}
        <nav className="md:hidden px-2.5 pb-1.5 grid grid-cols-4 gap-1 text-[11px] font-semibold tracking-tight">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`text-center py-2 rounded-lg transition-colors ${
                isActive(item.path)
                  ? 'text-primary bg-primary/10 font-bold'
                  : 'text-on-surface-variant hover:bg-surface-container-low'
              }`}
            >
              <span className="hidden md:inline">{item.desktopLabel}</span>
              <span className="md:hidden">{item.mobileLabel}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
