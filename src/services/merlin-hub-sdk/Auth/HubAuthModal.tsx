/**
 * Version: v2.0.1
 * Last Updated: 2026-05-23
 */
import React, { useState, useRef, useEffect } from 'react';
import { useHubAuth } from './useHubAuth';

interface HubAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  appName: string;
  appLogoUrl: string;
  title?: string;
  subtitleActionText?: string;
  onSuccess?: () => void;
}

/**
 * [Custom] 허브 통합 인증 모달 (Perfected v2.0.0 - AggroFilter Style)
 * 개별 앱에서 인증(로그인)이 필요할 때 띄우는 프리미엄 표준 모달입니다.
 * 앱 로고와 커스텀 서브타이틀을 받아 어그로필터와 동일한 세련된 UI를 제공합니다.
 */
export const HubAuthModal: React.FC<HubAuthModalProps> = ({
  isOpen,
  onClose,
  appName,
  appLogoUrl,
  title = "시작하기",
  subtitleActionText = "",
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
      reset();
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
      <div className="bg-white w-full max-w-[440px] rounded-[3rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] overflow-hidden relative animate-in zoom-in-95 duration-300 border-none">
        
        {/* 닫기 버튼 */}
        <button 
          onClick={onClose} 
          className="absolute top-6 right-6 text-slate-400 hover:text-slate-600 transition-colors p-2 hover:bg-slate-50 rounded-full z-10"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div className="px-8 pt-8 pb-6 flex flex-col items-center">
          
          {/* 1단계: 이메일 입력 */}
          {(status === 'idle' || status === 'sending' || (status === 'error' && codeDigits.every(d => d === ''))) && (
            <div className="w-full animate-in fade-in zoom-in-95 duration-300">
              
              {/* 로고 & 타이틀 영역 */}
              <div className="flex flex-col items-center gap-3 mb-6">
                <div className="space-y-1 text-center">
                  <h2 className="text-3xl font-black text-slate-900 tracking-tight flex flex-col sm:flex-row items-center justify-center gap-3">
                    <img
                      src={appLogoUrl}
                      alt={appName}
                      className="h-24 md:h-32 w-auto max-w-[200px] md:max-w-[250px] object-contain shrink"
                    />
                    <span className="shrink-0 whitespace-nowrap">{title}</span>
                  </h2>
                  <p className="mt-2 text-[15px] text-slate-400 font-bold tracking-tight flex items-center justify-center gap-1.5">
                    지금 바로 
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 border border-amber-100 shadow-sm">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-coins w-3.5 h-3.5"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>
                      무료 코인
                    </span> 
                    받아 {subtitleActionText ? `${subtitleActionText} 사용하세요` : '사용하세요'}
                  </p>
                </div>
              </div>

              <form onSubmit={handleSend} className="space-y-4">
                <input 
                  type="email" 
                  name="email"
                  autoComplete="email"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                  placeholder="이메일 주소 입력 (example@email.com)"
                  className="w-full h-16 bg-white border-2 border-slate-200 focus:border-blue-500 focus:bg-white focus:ring-8 focus:ring-blue-500/5 transition-all rounded-2xl text-[15px] sm:text-base font-bold px-6 text-center placeholder:text-slate-300 placeholder:font-medium outline-none"
                  required
                  autoFocus
                />
                
                {emailHistory.filter(e => e !== inputEmail).length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-center mt-1 animate-in fade-in duration-200">
                    {emailHistory.filter(e => e !== inputEmail).map((email) => (
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
                
                {error && (
                  <div className="bg-rose-50 text-rose-500 text-sm font-bold py-4 px-6 rounded-2xl border border-rose-100 text-center">
                    {error}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={status === 'sending'}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-700 text-white font-black text-xl rounded-2xl shadow-xl shadow-blue-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {status === 'sending' ? '발송 중...' : '인증코드 받기'}
                </button>
              </form>
            </div>
          )}

          {/* 2단계: 코드 입력 */}
          {(status === 'sent' || status === 'verifying' || (status === 'error' && codeDigits.some(d => d !== ''))) && (
            <div className="w-full space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-50 rounded-2xl mb-2">
                  <span className="text-3xl">📧</span>
                </div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">인증코드를 입력해주세요</h3>
                <div className="space-y-1">
                  <p className="text-base text-slate-400 font-bold">
                    <span className="text-blue-600 font-black">{inputEmail}</span>로<br/>
                    6자리 코드를 발송했습니다.
                  </p>
                  <p className="text-[11px] text-slate-400 font-bold tracking-tight opacity-70 flex items-center justify-center gap-2">
                    통합계정센터 <span className="text-slate-300">|</span> 
                    <span className="text-slate-500 font-mono">os.sundreamer.app</span>
                    <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{formatTimer()}</span>
                  </p>
                </div>
              </div>

              <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
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
                    className={`w-10 h-14 sm:w-12 sm:h-16 text-center text-2xl sm:text-3xl font-black border-2 sm:border-3 rounded-2xl outline-none transition-all ${
                      digit 
                        ? 'border-blue-500 bg-blue-50 text-blue-600 ring-4 ring-blue-500/10' 
                        : 'border-slate-200 bg-white text-slate-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/5'
                    }`}
                    disabled={status === 'verifying'}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <button 
                  type="button" 
                  onClick={() => sendOtp(inputEmail)} 
                  disabled={status === 'verifying'}
                  className="h-14 border-2 border-slate-100 text-slate-600 font-black text-base rounded-xl hover:bg-slate-50 hover:border-slate-200 transition-all flex items-center justify-center gap-2"
                >
                  🔄 인증코드 재발송
                </button>
                <button 
                  type="button" 
                  onClick={() => { reset(); setCodeDigits(['','','','','','']); }} 
                  className="h-12 text-slate-400 font-bold text-sm hover:text-slate-600 transition-colors"
                >
                  다른 이메일 주소 사용하기
                </button>
              </div>

              {error && (
                <div className="bg-rose-50 text-rose-500 text-sm font-bold py-4 px-6 rounded-2xl border border-rose-100 text-center">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* 3단계: 성공 */}
          {status === 'success' && (
            <div className="w-full text-center space-y-6 animate-in zoom-in duration-300 py-8">
              <div className="inline-flex items-center justify-center w-24 h-24 bg-green-50 text-green-500 rounded-full mb-2">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">인증 완료!</h3>
                <p className="text-base text-slate-500 font-bold">로그인이 성공적으로 완료되었습니다.</p>
              </div>
            </div>
          )}

          {/* 하단 브랜딩 (공통) */}
          <div className="text-center mt-6">
            <span className="text-[11px] text-slate-400 font-bold tracking-tight">
              시작 시 서비스 정책에 동의하게 됩니다.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
