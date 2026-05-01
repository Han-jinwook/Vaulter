/** 원장 계정 라벨 비교용 — 유니코드 호환 형태 통일 (query_ledger·UI 필터 공통) */
export function normalizeLedgerAccountLabel(s: unknown): string {
  return String(s ?? '').trim().normalize('NFKC')
}
