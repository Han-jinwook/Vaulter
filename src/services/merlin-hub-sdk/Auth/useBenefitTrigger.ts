import { useState, useEffect } from 'react';
import { useHub } from '../HubProvider';

export function markFreeTrialCompleted() {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem('merlin_free_trial_completed') !== 'true') {
    localStorage.setItem('merlin_free_trial_completed', 'true');
    localStorage.setItem('merlin_free_trial_completed_at', Date.now().toString());
    window.dispatchEvent(new CustomEvent('merlinFreeTrialCompleted'));
  }
}

export function useBenefitTrigger() {
  const { isLoggedIn } = useHub();
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // 만약 이미 로그인 상태라면 혜택 모달을 띄울 필요가 없음
    if (isLoggedIn) {
      setShouldShow(false);
      return;
    }

    const checkAndTrigger = () => {
      const hasCompletedTrial = localStorage.getItem('merlin_free_trial_completed') === 'true';
      const trialCompletedAt = localStorage.getItem('merlin_free_trial_completed_at');
      
      if (!hasCompletedTrial || !trialCompletedAt) return;
      
      const now = Date.now();
      const trialTime = parseInt(trialCompletedAt, 10);
      
      // 이번 세션에 이미 보여준 적이 있다면 더 이상 띄우지 않음
      if (sessionStorage.getItem('merlin_benefit_shown_this_session')) {
        return;
      }
      
      // 조건 1: 1회 체험 완료 직후라면, 완료된 시점으로부터 1분이 지났는지 확인
      const timeSinceTrial = now - trialTime;
      if (timeSinceTrial < 60000) {
        const timeout = setTimeout(() => {
          if (!localStorage.getItem('merlin_session_token') && !sessionStorage.getItem('merlin_benefit_shown_this_session')) {
            setShouldShow(true);
          }
        }, 60000 - timeSinceTrial);
        return () => clearTimeout(timeout);
      }

      // 조건 2: 이미 예전에 체험을 완료했고, 다음 번 세션(재방문)이라면 세션 시작 후 5분(300,000ms) 대기
      const sessionStart = sessionStorage.getItem('merlin_session_start_time');
      if (!sessionStart) {
        sessionStorage.setItem('merlin_session_start_time', now.toString());
      }
      
      const sessionStartTime = parseInt(sessionStorage.getItem('merlin_session_start_time') || now.toString(), 10);
      const timeInSession = now - sessionStartTime;
      
      if (timeInSession < 300000) {
        const timeout = setTimeout(() => {
           if (!localStorage.getItem('merlin_session_token') && !sessionStorage.getItem('merlin_benefit_shown_this_session')) {
             setShouldShow(true);
           }
        }, 300000 - timeInSession);
        return () => clearTimeout(timeout);
      }
      
      // 위 대기 조건들을 모두 통과했고 아직 이번 세션에 안 보여줬다면 띄움
      if (!sessionStorage.getItem('merlin_benefit_shown_this_session')) {
         setShouldShow(true);
      }
    };

    checkAndTrigger();
    
    // 이 세션 안에서 1회 체험이 방금 완료된 경우 이벤트를 받아 처리
    const handleTrialCompleted = () => {
       checkAndTrigger();
    };
    
    window.addEventListener('merlinFreeTrialCompleted', handleTrialCompleted);
    return () => window.removeEventListener('merlinFreeTrialCompleted', handleTrialCompleted);

  }, [isLoggedIn]);

  const closeBenefitModal = () => {
    setShouldShow(false);
    sessionStorage.setItem('merlin_benefit_shown_this_session', 'true');
  };

  return { shouldShow, closeBenefitModal };
}
