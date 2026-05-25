# Vaulter 로컬 DB (IndexedDB) 스키마 명세서

Vaulter(볼터)는 'Absolute Trust(데이터 주권 보장)'와 'Local-First' 철학에 따라, 유저의 모든 핵심 재무 원장과 채팅 기록을 브라우저의 IndexedDB에 우선 저장합니다.

- **데이터베이스 명**: `vaulter-local-vault`
- **현재 버전**: `3`

---

## 1. Object Stores (테이블 구조)

IndexedDB 내에는 크게 3개의 Object Store가 존재하며, 역할에 따라 데이터를 분산 보관합니다.

### 1.1. `kv` (Key-Value Store)
메타데이터, 채팅 내역, 유저 설정, 필터 상태 등 전반적인 앱 상태(Snapshot)를 통째로 저장하는 스토어입니다.

- **Key**: `vault_snapshot`
- **Value (Type: `VaultBackupSnapshot`)**:
  - `version` (number): 스냅샷 포맷 버전
  - `exportedAt` (string): 마지막 내보내기/저장 시간
  - `messages` (Array): 메인 지기 탭의 AI 채팅 내역 (`ChatMessage` 객체)
  - `assetMessages` (Array): 황금자산 탭 전용 AI 채팅 내역
  - `vaultMessages` (Array): 비밀금고 탭 전용 AI 채팅 내역
  - `secretVaultDocuments` (Array): 비밀금고에 업로드된 문서 메타데이터
  - `knownAccounts` (Array): 유저가 사용해 본 계좌/카드 이름 목록 (드롭다운 자동완성용)
  - `activeLedgerFilter`, `ledgerPeriodPreset` 등: 원장 UI 필터링 및 뷰어 상태 유지용 필드들

### 1.2. `ledger_lines` (원장 거래 스토어)
가계부/재무의 핵심인 **개별 거래 내역(Transaction)**을 1행 = 1레코드로 관리하는 스토어입니다. 
데이터가 수만 건으로 늘어났을 때 성능을 보장하기 위해 `kv` 스냅샷에서 분리되었습니다.

- **Key Path**: `id` (거래의 고유 ID)
- **Indexes**: `date` (날짜별 빠른 조회를 위한 인덱스)
- **Record (Type: `VaultTransaction`)**:
  - `id` (string): 고유 ID
  - `source` (string): 거래 출처 (`upload`, `gmail`, `manual`, `webhook`)
  - `date` (string): 거래 발생일 (예: '2026.05.23')
  - `amount` (number): 금액 (수입은 양수, 지출은 음수)
  - `merchant`, `name`, `location` (string): 가맹점 및 결제처 정보
  - `category` (string): 거래 분류 (예: '식비', '교통/차량')
  - `account` (string): 결제 계좌/카드 명
  - `type` (string): 'INCOME' | 'EXPENSE'
  - `status` (string): 'PENDING' (AI 분류 후 미확정) | 'CONFIRMED' (유저 확정)
  - `userMemo` (string): 유저가 남긴 추가 메모나 AI의 추론 이유
  - `linkedDocumentId` (string | null): 이 거래를 증빙하는 영수증/문서의 ID

### 1.3. `assets` (황금자산 스토어)
유저가 소유한 자산(예금, 부동산, 대출, 주식 등)의 현황을 관리하는 스토어입니다.

- **Key Path**: `id` (자산 라인의 고유 ID)
- **Record (Type: `AssetLine`)**:
  - (코드베이스의 `AssetLine` 인터페이스를 따름 - 자산 유형, 명칭, 현재 가치, 매수 단가 등의 정보 포함)

---

## 2. 동기화 및 백업 (Backup & Sync) 전략

1. **상시 로컬 저장 (Persist)**: 유저가 탭을 전환하거나 데이터가 변경된 후 잠시 대기(Idle)하면 Zustand 스토어의 변경사항이 IndexedDB로 자동 Flush(저장)됩니다.
2. **구글 드라이브 백업 (Drive AppData)**: 로컬 DB의 내용 중 `kv` + `ledger_lines` + `assets` 데이터를 하나의 완전한 JSON 스냅샷으로 병합(`buildFullBackupSnapshot`)하여, 유저 개인 구글 드라이브의 숨겨진 `appDataFolder`에 수시로 덮어쓰기 백업합니다.
3. **오프라인 퍼스트**: 모든 렌더링과 데이터 읽기/쓰기는 우선 IndexedDB를 거치므로 오프라인 상태에서도 완벽하게 동작하며, 로딩 딜레이가 없습니다.
