export type AssetLineType = 'ASSET' | 'DEBT'

/** 금액/메모 변경 시 남기는 히스토리 한 줄. `date` = YYYY-MM-DD (평가/변동 기준일) */
export type AssetHistoryEntry = {
  date: string
  amount: number
  memo: string
}

export type AssetLine = {
  id: string
  type: AssetLineType
  category: string
  name: string
  amount: number
  /** YYYY-MM-DD, 취득/최종 평가 기준일(화면 표시) */
  asOfDate: string
  /** 최초 레코드 생성용 ISO(첫 `asOfDate` 자정 UTC 등, 시스템 "지금"과 무관) */
  createdAt: string
  /** 항목 보조 설명 (평단, 담보 등) */
  memo?: string
  /** 등록/금액·메모 변경 이력 */
  history?: AssetHistoryEntry[]
}
