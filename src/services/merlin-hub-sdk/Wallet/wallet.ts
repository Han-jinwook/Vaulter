import { hubFetch } from '../CoreLogic/client';
import { getConfig } from '../CoreLogic/config';

export interface WalletBalance {
  balance: number;
  userId: string;
}

/**
 * 1. 현재 크레딧 잔액 조회
 * @param userId UUID (Hub family_uid)
 */
export async function getBalance(userId: string): Promise<{ success: boolean; balance?: number; error?: string }> {
  try {
    const { ok, data } = await hubFetch<any>(`/api/wallet/balance?userId=${encodeURIComponent(userId)}`);
    if (!ok) return { success: false, error: data?.message || '잔액 조회 실패' };
    return { success: true, balance: data.balance };
  } catch (err) {
    console.error('[MerlinHub] getBalance error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * 2. 과금 단가표 조회 (Pricing Info)
 * @param videoId 영상 ID (resource_id)
 */
export async function getPricing(videoId: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const config = getConfig();
    const appId = config.appId;
    if (!appId) {
      return { success: false, error: 'App ID가 설정되지 않았습니다. configureMerlinHub({ appId: "..." })를 호출해 주세요.' };
    }
    const { ok, data } = await hubFetch<any>(`/api/wallet/pricing?app_id=${appId}&action_type=ANALYSIS&resource_id=${videoId}`);
    if (!ok) return { success: false, error: data?.message || '단가 조회 실패' };
    return { success: true, data: data.data };
  } catch (err) {
    console.error('[MerlinHub] getPricing error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * 3. 통합 트랜잭션 처리 (고정가 차감)
 */
export async function processTransaction(params: {
  userId: string;
  amount: number;
  requestId: string;
  displayText: string;
  usageMetadata?: any;
}): Promise<{ success: boolean; balance?: number; error?: string }> {
  try {
    const appId = getConfig().appId;
    if (!appId) {
      return { success: false, error: 'App ID가 설정되지 않았습니다. configureMerlinHub({ appId: "..." })를 호출해 주세요.' };
    }
    const { ok, data } = await hubFetch<any>('/api/wallet/transaction', {
      method: 'POST',
      body: JSON.stringify({
        userId: params.userId,
        amount: params.amount,
        request_id: params.requestId,
        transaction_type: params.amount < 0 ? 'SPEND' : 'CHARGE',
        display_text: params.displayText,
        app_id: appId,
        usage_metadata: params.usageMetadata
      }),
    });
    if (!ok) return { success: false, error: data?.message || '트랜잭션 처리 실패' };
    return { success: true, balance: data.balance };
  } catch (err) {
    console.error('[MerlinHub] processTransaction error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * 4. 동적 과금 계산 및 청구 (신규 영상 분석 시)
 */
export async function chargeDynamic(params: {
  userId: string;
  videoId: string;
  rawCost?: number;
  usageMetrics?: {
    gpt4oMiniTokens?: number;
    gemini25FlashTokens?: number;
    googleSearchCount?: number;
    speedTokens?: number; // 하위 호환
    fullTokens?: number;  // 하위 호환
    [key: string]: any;
  };
  requestId: string;
  displayText: string;
  usageMetadata?: any;
}): Promise<{ success: boolean; balance?: number; error?: string; price?: number }> {
  try {
    const appId = getConfig().appId;
    if (!appId) {
      return { success: false, error: 'App ID가 설정되지 않았습니다. configureMerlinHub({ appId: "..." })를 호출해 주세요.' };
    }
    const { ok, data } = await hubFetch<any>('/api/wallet/transaction/dynamic', {
      method: 'POST',
      body: JSON.stringify({
        userId: params.userId,
        app_id: appId,
        resource_id: params.videoId,
        raw_cost: params.rawCost,
        usage_metrics: params.usageMetrics ? {
          gpt_4o_mini_tokens: params.usageMetrics.gpt4oMiniTokens || params.usageMetrics.speedTokens,
          gemini_2_5_flash_tokens: params.usageMetrics.gemini25FlashTokens || params.usageMetrics.fullTokens,
          google_search_count: params.usageMetrics.googleSearchCount
        } : undefined,
        request_id: params.requestId,
        display_text: params.displayText,
        usage_metadata: params.usageMetadata
      }),
    });
    if (!ok) return { success: false, error: data?.message || '동적 과금 처리 실패' };
    return { success: true, balance: data.balance, price: data.price };
  } catch (err) {
    console.error('[MerlinHub] chargeDynamic error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * 5. 이용 내역 조회 (History)
 */
export async function getHistory(userId: string, page: number = 1): Promise<{ 
  success: boolean; 
  history?: any[]; 
  total?: number; 
  totalPages?: number; 
  error?: string;
}> {
  try {
    const { ok, data } = await hubFetch<any>(`/api/wallet/history?userId=${encodeURIComponent(userId)}&page=${page}`);
    if (!ok) return { success: false, error: data?.message || '내역 조회 실패' };
    return { 
      success: true, 
      history: data.history, 
      total: data.total, 
      totalPages: data.totalPages 
    };
  } catch (err) {
    console.error('[MerlinHub] getHistory error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * KCP 결제 준비 요청
 */
export async function requestKcpPayment(params: {
  amount: number;
  coinAmount: number;
  payMethodType: 'card' | 'phone' | 'bank';
  returnUrl: string;
}): Promise<{ success: boolean; paymentData?: any; error?: string }> {
  try {
    const config = getConfig();
    const appId = config.appId;
    if (!appId) {
      return { success: false, error: 'App ID가 설정되지 않았습니다. configureMerlinHub({ appId: "..." })를 호출해 주세요.' };
    }
    const { ok, data } = await hubFetch<any>('/api/payment/prepare', {
      method: 'POST',
      body: JSON.stringify({
        amount: params.amount,
        coin_amount: params.coinAmount,
        pay_method_type: params.payMethodType,
        app_id: appId,
        return_url: params.returnUrl
      }),
    });
    if (!ok) return { success: false, error: data?.message || '결제 준비 실패' };
    return { success: true, paymentData: data.payment_data };
  } catch (err) {
    console.error('[MerlinHub] requestKcpPayment error:', err);
    return { success: false, error: '허브 서버 연결 실패' };
  }
}

/**
 * 6. 크레딧 사용 (고급 래퍼)
 */
export async function useCredit(params: {
  amount: number;
  displayText: string;
  requestId: string;
}) {
  const userId = getUserId();
  if (!userId) return { success: false, error: '로그인이 필요합니다.' };

  return processTransaction({
    userId,
    amount: -Math.abs(params.amount),
    requestId: params.requestId,
    displayText: params.displayText
  });
}

/**
 * 7. 현재 로컬 스토리지에서 유저 ID 추출
 */
export function getUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('merlin_user_id') || localStorage.getItem('merlin_family_uid');
}
