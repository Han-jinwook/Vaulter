'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Mail, User, Edit2, Save, X, LogOut, Bell } from 'lucide-react';
import { MerlinHub } from '../index';
import { HubAvatar } from './HubProfileWidget';
import { useHub } from '../HubProvider';

// -----------------------------------------
// 1. HubProfileCard (상단 섹션: 프로필 뷰 및 수정)
// -----------------------------------------
export interface HubProfileCardProps {
  onSuccess?: (nickname: string, avatarUrl: string) => void;
  className?: string;
}

export const HubProfileCard: React.FC<HubProfileCardProps> = ({ onSuccess, className = '' }) => {
  const { user, isLoggedIn } = useHub();
  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [profileImage, setProfileImage] = useState('');
  const [email, setEmail] = useState('');
  const [tempNickname, setTempNickname] = useState('');
  const [tempProfileImage, setTempProfileImage] = useState('');

  useEffect(() => {
    // 로컬 스토리지에서 기본값 가져오기
    const storedEmail = localStorage.getItem('userEmail');
    const storedNickname = localStorage.getItem('userNickname');
    const storedProfileImage = localStorage.getItem('userProfileImage');

    setNickname(storedNickname || '게스트');
    setProfileImage(storedProfileImage || '');
    // isLoggedIn 상태이거나 user.email이 있거나 storedEmail이 있으면 세팅
    setEmail(user?.email || storedEmail || '');

    if (isLoggedIn) {
      // 서버에서 최신 프로필 정보 갱신
      MerlinHub.auth.getProfile()
        .then(result => {
          if (result.success) {
            const dbNickname = result.nickname || storedEmail?.split('@')[0] || '회원';
            const dbImage = result.avatar_url || '';
            setNickname(dbNickname);
            setProfileImage(dbImage);
            localStorage.setItem('userNickname', dbNickname);
            localStorage.setItem('userProfileImage', dbImage);
          }
        })
        .catch(() => {});
    }
  }, [isLoggedIn, user]);

  const handleEdit = () => {
    setTempNickname(nickname);
    setTempProfileImage(profileImage);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (tempNickname.trim()) {
      if (isLoggedIn) {
        try {
          const result = await MerlinHub.auth.updateProfile({
            nickname: tempNickname,
            avatar_url: tempProfileImage || ''
          });

          if (result.success) {
            const savedNickname = result.nickname || tempNickname;
            const savedImage = result.avatar_url || '';
            setNickname(savedNickname);
            setProfileImage(savedImage);
            localStorage.setItem('userNickname', savedNickname);
            localStorage.setItem('userProfileImage', savedImage);
            window.dispatchEvent(new Event('profileUpdated'));
            setIsEditing(false);
            if (onSuccess) onSuccess(savedNickname, savedImage);
          } else {
            console.error('Failed to update profile:', result.error);
            alert(result.error || '프로필 수정에 실패했습니다.');
          }
        } catch (error) {
          console.error('Profile update error:', error);
        }
      } else {
        // 비회원 로컬 변경
        setNickname(tempNickname);
        setProfileImage(tempProfileImage || '');
        localStorage.setItem('userNickname', tempNickname);
        localStorage.setItem('userProfileImage', tempProfileImage || '');
        window.dispatchEvent(new Event('profileUpdated'));
        setIsEditing(false);
        if (onSuccess) onSuccess(tempNickname, tempProfileImage || '');
      }
    }
  };

  const handleCancel = () => {
    setTempNickname('');
    setTempProfileImage('');
    setIsEditing(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const maxSide = 200;

          if (width > height) {
            if (width > maxSide) {
              height = Math.round((height * maxSide) / width);
              width = maxSide;
            }
          } else {
            if (height > maxSide) {
              width = Math.round((width * maxSide) / height);
              height = maxSide;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
            setTempProfileImage(compressedBase64);
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const getDisplayNickname = () => isEditing ? tempNickname : nickname;
  const getDisplayImage = () => isEditing ? tempProfileImage : profileImage;

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sm:p-8 ${className}`}>
      <div className="flex items-start justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-900">프로필 정보</h2>
        {!isEditing && (
          <button
            onClick={handleEdit}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors mt-0.5"
          >
            <Edit2 className="h-3.5 w-3.5" />
            수정하기
          </button>
        )}
      </div>

      <div className="space-y-6">
        {/* 프로필 이미지 */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <HubAvatar 
              isLoggedIn={isLoggedIn}
              avatarUrl={getDisplayImage()}
              nickname={getDisplayNickname()}
              size="lg"
              className="border border-slate-200 shadow-sm"
            />
            {isEditing && (
              <label className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-blue-600 text-white flex items-center justify-center cursor-pointer hover:bg-blue-700 transition-colors shadow-md border-2 border-white">
                <Camera className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700">프로필 사진</p>
            {isEditing && (
              <p className="text-xs font-medium text-slate-500 mt-1">
                클릭하여 이미지 변경
              </p>
            )}
          </div>
        </div>

        {/* 이메일 & 닉네임 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 이메일 */}
          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-500 mb-2">
              <Mail className="h-4 w-4" />
              이메일
            </label>
            {!isLoggedIn ? (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('openLoginModal'))}
                className="w-full rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 hover:from-blue-100 hover:to-indigo-100 transition-colors cursor-pointer overflow-hidden group h-[46px]"
              >
                <div className="flex items-center gap-3 px-4 h-full">
                  <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm text-blue-600 group-hover:scale-110 transition-transform">
                    <Mail className="h-3.5 w-3.5" />
                  </div>
                  <div className="text-left flex-1 flex items-center justify-between">
                    <p className="text-sm font-bold text-blue-800">이메일 등록/로그인 👋</p>
                  </div>
                </div>
              </button>
            ) : (
              <input
                type="email"
                value={email}
                disabled
                className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-500 cursor-not-allowed text-sm font-medium h-[46px]"
              />
            )}
          </div>

          {/* 닉네임 */}
          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-500 mb-2">
              <User className="h-4 w-4" />
              닉네임
            </label>
            <input
              type="text"
              value={isEditing ? tempNickname : nickname}
              onChange={(e) => setTempNickname(e.target.value)}
              disabled={!isEditing}
              className={`w-full px-4 py-3 border rounded-xl text-sm font-medium transition-colors h-[46px] ${
                isEditing
                  ? 'bg-white border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900'
                  : 'bg-slate-50 border-slate-200 text-slate-700 cursor-not-allowed'
              }`}
            />
          </div>
        </div>

        {/* 편집 모드 버튼들 */}
        {isEditing && (
          <div className="flex gap-3 pt-4 border-t border-slate-100 mt-6">
            <button
              onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              className="flex-[2] flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-200"
            >
              <Save className="h-4 w-4" />
              저장하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// -----------------------------------------
// 2. HubNotificationCard (중단 섹션: 스마트 알림 설정)
// -----------------------------------------
export interface HubNotificationCardProps {
  title?: string;
  toggleLabel?: string;
  description?: React.ReactNode;
  enabled?: boolean;
  onChange?: (enabled: boolean) => void;
  className?: string;
  children?: React.ReactNode;
}

export const HubNotificationCard: React.FC<HubNotificationCardProps> = ({
  title = '알림 설정',
  toggleLabel = '🔔 스마트 알림',
  description = '허브 서비스의 새로운 기능과 혜택 알림을 관리합니다.',
  enabled,
  onChange,
  className = '',
  children
}) => {
  const { isLoggedIn } = useHub();
  const [internalEnabled, setInternalEnabled] = useState(true);

  useEffect(() => {
    if (enabled === undefined) {
      const stored = localStorage.getItem('hubSmartNotification') || localStorage.getItem('hubMarketingConsent');
      if (stored === 'false') {
        setInternalEnabled(false);
      } else {
        setInternalEnabled(true);
      }
    }
  }, [enabled]);

  const isToggled = enabled !== undefined ? enabled : internalEnabled;

  const handleToggle = () => {
    const nextVal = !isToggled;
    if (onChange) {
      onChange(nextVal);
    } else {
      setInternalEnabled(nextVal);
      localStorage.setItem('hubSmartNotification', nextVal ? 'true' : 'false');
      localStorage.setItem('hubMarketingConsent', nextVal ? 'true' : 'false');
    }
  };

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${className}`}>
      <div className="p-6 sm:p-8">
        <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 mb-6">
          <Bell className="h-5 w-5" />
          {title}
        </h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="min-w-0 pr-4">
              <p className="text-sm font-bold text-slate-900">{toggleLabel}</p>
              {typeof description === 'string' ? (
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {description}
                </p>
              ) : (
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {description}
                </div>
              )}
            </div>
            <button
              onClick={handleToggle}
              disabled={!isLoggedIn}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                !isLoggedIn ? 'bg-slate-200 cursor-not-allowed opacity-50' :
                isToggled ? 'bg-blue-600' : 'bg-slate-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isToggled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {children && (
            <div className="pt-4 border-t border-slate-100 mt-4">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


// -----------------------------------------
// 3. HubLogoutCard (하단 섹션: 로그아웃)
// -----------------------------------------
export interface HubLogoutCardProps {
  onLogout?: () => void;
  className?: string;
}

export const HubLogoutCard: React.FC<HubLogoutCardProps> = ({ onLogout, className = '' }) => {
  const { isLoggedIn } = useHub();

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        localStorage.clear();
        window.dispatchEvent(new Event('profileUpdated'));
        if (onLogout) onLogout();
      });
  };

  if (!isLoggedIn) return null;

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-rose-100 overflow-hidden ${className}`}>
      <div className="p-6 sm:p-8">
        <p className="text-sm text-slate-500 mb-4">
          로그아웃하면 메인 페이지로 이동합니다.
        </p>

        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-rose-50 border border-rose-200 text-rose-600 font-bold rounded-xl hover:bg-rose-100 hover:border-rose-300 transition-colors shadow-sm"
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </button>
      </div>
    </div>
  );
};
