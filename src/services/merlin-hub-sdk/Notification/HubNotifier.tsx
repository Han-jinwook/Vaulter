'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

/**
 * Merlin Hub 표준 알림(Toast) 컴포넌트
 * layout.tsx 최상단에 배치하여 시스템 전체 알림을 관리합니다.
 */
export function HubNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);

    // 5초 후 자동 삭제
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  useEffect(() => {
    const handleToastEvent = (event: any) => {
      const { type, message } = event.detail;
      addToast(type || 'info', message);
    };

    window.addEventListener('hub-toast', handleToastEvent);
    return () => window.removeEventListener('hub-toast', handleToastEvent);
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-full">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 p-4 rounded-2xl shadow-2xl border animate-in slide-in-from-right-8 fade-in duration-300 ${
            toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
            toast.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
            toast.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' :
            'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="shrink-0 mt-0.5">
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5" />}
            {toast.type === 'info' && <Info className="w-5 h-5" />}
            {toast.type === 'warning' && <AlertCircle className="w-5 h-5" />}
          </div>
          <div className="flex-1 text-sm font-bold leading-relaxed">
            {toast.message}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * 외부에서 알림을 띄울 때 사용하는 헬퍼 함수
 */
export const showToast = (message: string, type: ToastType = 'info') => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('hub-toast', { detail: { type, message } }));
};
