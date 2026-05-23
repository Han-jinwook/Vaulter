/**
 * Version: v1.1.1
 * Last Updated: 2026-05-16
 */
import React, { useState, useRef, useEffect } from 'react';
import { useHubAuth } from './useHubAuth';

interface HubAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  appName: string;
  appLogoUrl: string;
  onSuccess?: () => void;
}

/**
 * [Custom] 허브 통합 인증 모달 (Perfected v1.1.1)
 * 개별 앱에서 인증(로그인)이 필요할 때 띄우는 프리미엄 표준 모달입니다.
 * 어그로필터에서 검증된 6자리 분할 입력 및 고도화된 UX를 반영했습니다.
 */
export const HubAuthModal: React.FC<HubAuthModalProps> = ({
  isOpen,
  onClose,
  appName,
  appLogoUrl,
  onSuccess,
}) => {
  const { status, sendOtp, verifyOtp, timer, formatTimer, error, reset } = useHubAuth();
  const [inputEmail, setInputEmail] = useState('');
  const [emailHistory, setEmailHistory] = useState<string[]>([]);
  const [codeDigits, setCodeDigits] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // 모달이 열릴 때 초기화 및 이메일 히스토리 로드
  useEffect(() => {
    if (isOpen) {
      // reset(); // 기존 상태 유지할지 여부 선택 가능
      if (typeof window !== 'undefined') {
        try {
          const history = JSON.parse(localStorage.getItem('merlin_email_history') || '[]');
          if (Array.isArray(history)) {
            setEmailHistory(history.filter(h => typeof h === 'string' && h.includes('@')));
          }
        } catch (_) {}
      }
    } else {
      setCodeDigits(['', '', '', '', '', '']);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;

    if (inputEmail && inputEmail.includes('@')) {
      try {
        const history = JSON.parse(localStorage.getItem('merlin_email_history') || '[]');
        const filtered = history.filter((h: string) => h !== inputEmail);
        const newHistory = [inputEmail, ...filtered].slice(0, 4);
        localStorage.setItem('merlin_email_history', JSON.stringify(newHistory));
        setEmailHistory(newHistory);
      } catch (_) {}
    }

    await sendOtp(inputEmail);
  };

  const handleDigitChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...codeDigits];
    newDigits[index] = value.slice(-1);
    setCodeDigits(newDigits);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // 6자리가 모두 채워지면 자동 검증
    if (newDigits.every(d => d !== '') && newDigits.join('').length === 6) {
      handleVerify(newDigits.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newDigits = pasted.split('');
      setCodeDigits(newDigits);
      handleVerify(pasted);
    }
  };

  const handleVerify = async (fullCode: string) => {
    if (status === 'verifying') return;
    const success = await verifyOtp(fullCode);
    if (success && onSuccess) {
      onSuccess();
    } else if (!success) {
      // 실패 시 입력값 초기화 및 첫 번째 칸 포커스
      setCodeDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 50);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-[440px] rounded-[2.5rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] overflow-hidden relative animate-in zoom-in-95 duration-300 border-none">
        
        {/* 닫기 버튼 */}
        <button 
          onClick={onClose} 
          className="absolute top-8 right-8 text-slate-300 hover:text-slate-500 transition-colors p-2 hover:bg-slate-50 rounded-full"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div className="px-10 pt-12 pb-10 flex flex-col items-center">
          {/* 앱 로고 섹션 */}
          <div className="mb-8 relative">
            <div className="w-20 h-20 bg-white rounded-3xl p-3 shadow-[0_8px_20px_rgba(0,0,0,0.06)] border border-slate-50 flex items-center justify-center overflow-hidden">
              <img src={appLogoUrl} alt={appName} className="w-full h-full object-contain" />
            </div>
          </div>

          <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight">{appName}</h2>
          <p className="text-slate-400 text-[15px] font-bold mb-10">간편하게 시작해보세요</p>

          {/* 1단계: 이메일 입력 */}
          {(status === 'idle' || status === 'sending' || (status === 'error' && codeDigits.every(d => d === ''))) && (
            <form onSubmit={handleSend} className="w-full space-y-5 animate-in fade-in zoom-in-95 duration-300">
              <div className="relative">
                <input 
                  type="email" 
                  name="email"
                  autoComplete="email"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full h-16 px-6 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white outline-none transition-all text-xl font-bold placeholder:text-slate-300 text-center"
                  required
                  autoFocus
                />
              </div>
              
              {emailHistory.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center -mt-2 animate-in fade-in duration-200">
                  {emailHistory.map((email) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => setInputEmail(email)}
                      className="text-xs px-3 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-all border border-slate-200/50"
                    >
                      {email}
                    </button>
                  ))}
                </div>
              )}
              
              <button 
                type="submit"
                disabled={status === 'sending'}
                className="w-full h-16 bg-blue-600 text-white rounded-2xl font-black text-xl hover:bg-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50"
              >
                {status === 'sending' ? '발송 중...' : '인증코드 받기'}
              </button>

              {error && (
                <div className="bg-rose-50 text-rose-500 text-sm font-bold py-4 px-6 rounded-2xl border border-rose-100 text-center">
                  {error}
                </div>
              )}
            </form>
          )}

          {/* 2단계: 코드 입력 */}
          {(status === 'sent' || status === 'verifying' || (status === 'error' && codeDigits.some(d => d !== ''))) && (
            <div className="w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center space-y-4">
                <div className="space-y-1">
                  <p className="text-base text-slate-500 font-bold">
                    <span className="text-blue-600 font-black">{inputEmail}</span>로<br/>
                    인증코드를 발송했습니다.
                  </p>
                  <p className="text-[11px] text-slate-300 font-bold tracking-tight">
                    통합계정센터 <span className="mx-1 opacity-30">|</span> <span className="text-slate-400">os.sundreamer.app</span>
                  </p>
                </div>
                <div className="text-lg font-black text-blue-600 bg-blue-50/50 inline-block px-4 py-1.5 rounded-full border border-blue-100/50">
                  {formatTimer()}
                </div>
              </div>

              <div className="flex justify-center gap-3" onPaste={handlePaste}>
                {codeDigits.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { inputRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleDigitChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className={`w-12 h-16 text-center text-3xl font-black border-2 rounded-2xl outline-none transition-all ${
                      digit 
                        ? 'border-blue-500 bg-blue-50 text-blue-600 ring-4 ring-blue-500/10' 
                        : 'border-slate-100 bg-slate-50 text-slate-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/5 focus:bg-white'
                    }`}
                    disabled={status === 'verifying'}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              <div className="flex flex-col gap-4">
                <button 
                  type="button" 
                  onClick={() => sendOtp(inputEmail)} 
                  disabled={status === 'verifying'}
                  className="h-14 border-2 border-slate-50 text-slate-500 font-bold text-base rounded-2xl hover:bg-slate-50 hover:border-slate-100 transition-all flex items-center justify-center gap-2"
                >
                  🔄 인증코드 재발송
                </button>
                <button 
                  type="button" 
                  onClick={reset} 
                  className="text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors py-2"
                >
                  이메일 주소 변경하기
                </button>
              </div>

              {error && (
                <div className="bg-rose-50 text-rose-500 text-sm font-bold py-4 px-6 rounded-2xl border border-rose-100 text-center">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* 하단 브랜딩 */}
          <div className="mt-12 pt-8 border-t border-slate-50 w-full text-center">
            <span className="text-[10px] text-slate-300 font-bold tracking-[0.2em] uppercase">
              Sundreamer Merlin Family
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
