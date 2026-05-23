/**
 * Version: v1.0.0
 * Last Updated: 2026-05-24
 */
import React, { useState, useEffect } from 'react';
import { Camera, Mail, User, Edit2, Save, X, LogOut } from 'lucide-react';
import { MerlinHub } from '../index';
import { HubAvatar } from './HubProfileWidget';

export interface HubProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (nickname: string, avatarUrl: string) => void;
  onLogout?: () => void;
}

export const HubProfileModal: React.FC<HubProfileModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onLogout,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [profileImage, setProfileImage] = useState('');
  const [email, setEmail] = useState('');
  const [isAnon, setIsAnon] = useState(true);
  const [tempNickname, setTempNickname] = useState('');
  const [tempProfileImage, setTempProfileImage] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const storedEmail = localStorage.getItem('userEmail');
    const anon = !storedEmail || localStorage.getItem('userId') === null;
    setIsAnon(anon);

    if (storedEmail && !anon) {
      setEmail(storedEmail);
      MerlinHub.auth.getProfile()
        .then(result => {
          if (result.success) {
            const dbNickname = result.nickname || storedEmail.split('@')[0];
            const dbImage = result.avatar_url || '';
            setNickname(dbNickname);
            setProfileImage(dbImage);
            localStorage.setItem('userNickname', dbNickname);
            localStorage.setItem('userProfileImage', dbImage);
          }
        })
        .catch(() => {
          const savedNickname = localStorage.getItem('userNickname');
          const savedProfileImage = localStorage.getItem('userProfileImage');
          if (savedNickname) setNickname(savedNickname);
          if (savedProfileImage) setProfileImage(savedProfileImage);
        });
    } else {
      const savedNickname = localStorage.getItem('userNickname');
      const savedProfileImage = localStorage.getItem('userProfileImage');
      setNickname(savedNickname || '게스트');
      setProfileImage(savedProfileImage || '');
      setEmail('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEdit = () => {
    setTempNickname(nickname);
    setTempProfileImage(profileImage);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (tempNickname.trim()) {
      const storedEmail = localStorage.getItem('userEmail');
      
      if (storedEmail && !isAnon) {
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
            console.error('Failed to update profile in Hub:', result.error);
            alert(result.error || '프로필 수정에 실패했습니다.');
          }
        } catch (error) {
          console.error('Profile update error:', error);
        }
      } else {
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

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => {
        localStorage.clear();
        setNickname('');
        setProfileImage('');
        window.dispatchEvent(new Event('profileUpdated'));
        onClose();
        if (onLogout) onLogout();
      });
  };

  const getDisplayNickname = () => isEditing ? tempNickname : nickname;
  const getDisplayImage = () => isEditing ? tempProfileImage : profileImage;

  const showLogoutSection = !isAnon || (nickname.trim().length > 0 && nickname !== '게스트');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8">
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
                  isLoggedIn={!isAnon}
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
            <div className="space-y-4">
              {/* 이메일 */}
              <div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-500 mb-2">
                  <Mail className="h-4 w-4" />
                  이메일
                </label>
                {isAnon ? (
                  <button
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new CustomEvent('openLoginModal'));
                    }}
                    className="w-full rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 hover:from-blue-100 hover:to-indigo-100 transition-colors cursor-pointer overflow-hidden group"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm text-blue-600 group-hover:scale-110 transition-transform">
                        <Mail className="h-5 w-5" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-blue-800">이메일 등록/로그인 👋</p>
                        <p className="text-[11px] font-medium text-blue-600 mt-0.5">기록을 안전하게 보존하세요</p>
                      </div>
                    </div>
                  </button>
                ) : (
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-slate-50 text-slate-500 cursor-not-allowed text-sm font-medium"
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
                  className={`w-full px-4 py-3 border rounded-xl text-sm font-medium transition-colors ${
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

        {/* 로그아웃 섹션 */}
        {showLogoutSection && !isEditing && (
          <div className="bg-slate-50 border-t border-slate-100 p-6 sm:p-8">
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-white border border-rose-200 text-rose-600 font-bold rounded-xl hover:bg-rose-50 transition-colors shadow-sm"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
