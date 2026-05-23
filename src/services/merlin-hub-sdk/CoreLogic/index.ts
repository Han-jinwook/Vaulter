/**
 * Merlin Hub SDK
 * ─────────────────────────────────────────────
 * 싱글턴 패턴 SDK — 다른 패밀리 앱에서도 복사하여 재사용 가능
 * 
 * 사용법:
 *   import { MerlinHub } from '@/src/services/merlin-hub-sdk';
 *   await MerlinHub.auth.requestOTP('user@example.com');
 *   const result = await MerlinHub.auth.verifyOTP('user@example.com', '123456');
 *   const balance = await MerlinHub.wallet.getBalance();
 */

export { configureMerlinHub, getConfig } from './config';
export type { MerlinHubConfig } from './config';

export { hubFetch, getSessionToken, setSessionToken, clearSessionToken, isTokenExpired, MerlinHubClient } from './client';
export type { HubFetchResult } from './client';

export { requestOTP, verifyOTP, checkSession, logout, updateProfile, getProfile } from '../Auth/auth';
export type { OTPRequestResult, OTPVerifyResult, ProfileUpdateParams, ProfileResult } from '../Auth/auth';

export { useCredit, getBalance, getUserId, requestKcpPayment } from '../Wallet/wallet';
export type { WalletBalance } from '../Wallet/wallet';

// ── Namespace export for convenience ──
import * as auth from '../Auth/auth';
import * as wallet from '../Wallet/wallet';
import * as client from './client';
import { configureMerlinHub, getConfig } from './config';

export const MerlinHub = {
  configure: configureMerlinHub,
  getConfig,
  auth,
  wallet,
  client,
} as const;
