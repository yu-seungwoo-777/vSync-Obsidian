# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - SPEC-P10-CAMELCASE-001 (2026-04-20)

#### DTO 변환 계층 도입
- `src/dto/` 디렉토리 신규 생성 (6개 파일)
  - `index.ts`: 공개 API 및 유틸리티
  - `types.ts`: DTO 타입 정의
  - `file.dto.ts`: 파일 관련 DTO 변환 함수
  - `sync.dto.ts`: 동기화 이벤트 DTO 변환
  - `vault.dto.ts`: 볼트 DTO 변환
  - `conflict.dto.ts`: 충돌 DTO 변환
- `toWire*()` 변환 함수: 내부 camelCase → API 응답 snake_case
- `fromWire*()` 변환 함수: API 요청 snake_case → 내부 camelCase

#### 내부 코드 camelCase 복원
- **DB 스키마** (`src/db/schemas/`): Drizzle ORM TS 속성명 camelCase 복원
  - `files.ts`: `vault_id` → `vaultId`, `size_bytes` → `sizeBytes`, etc.
  - `file-versions.ts`: `file_id` → `fileId`, `version_num` → `versionNum`, etc.
  - `sync-events.ts`: `event_type` → `eventType`, `device_id` → `deviceId`, etc.
  - `device-sync-state.ts`, `conflicts.ts`, `vaults.ts` 동일 패턴
  - DB 컬럼명은 snake_case 유지 (Drizzle 자동 매핑)

- **서비스 계층** (`src/services/`): 12개 파일 타입/변수/함수명 camelCase 복원
  - `file.ts`: `UploadResult`, `ConflictResult` 타입 속성 복원
  - `three-way-merge.ts`: `base_lines` → `baseLines`, etc.
  - `websocket.ts`: 클래스 속성 `_heartbeat_interval_ms` → `_heartbeatIntervalMs`, etc.
  - `conflict.ts`, `search.ts`, `sync-event.ts`, `attachment.ts`, `export.ts`, `version-cleanup.ts`, `realtime-sync.ts`, `auth.ts`, `vault.ts`
  - 하위 호환성을 위해 snake_case alias export 추가

- **라우트 계층** (`src/routes/v1.ts`): 핸들러 변수명 camelCase 복원
  - 지역 변수: `vault_id` → `vaultId`, `auth_headers` → `authHeaders`, etc.
  - API 응답: DTO 변환 함수 사용하여 snake_case wire format 유지

- **테스트 코드** (`src/tests/`): 38개 파일 변수명 camelCase 업데이트
  - 테스트 변수: `vault_id` → `vaultId`, `file_path` → `filePath`, etc.
  - API 응답 필드는 snake_case 유지 (wire format 검증)

#### ESLint 설정 개선
- `eslint.config.js`: `languageOptions.parserOptions` 추가
  - `project: ['./tsconfig.json']`: 타입 정보 기반 naming-convention 규칙 활성화
  - `ecmaVersion: 2022`, `sourceType: 'module'`: ES2022 모듈 지원
- 하위 호환 snake_case export 허용 (property selector: `format: null`)

#### 하위 호환성 보장
- 모든 리네임된 함수에 snake_case alias export 추가
- API 요청/응답 wire format은 snake_case 유지 (OpenAPI 명세 준수)
- DB 컬럼명 변경 없음 (마이그레이션 불필요)

### Changed
- 내부 코드 표준: TypeScript 생태계 표준 camelCase 준수
- Drizzle ORM: TS 속성명=camelCase, DB 컬럼명=snake_case 기본 매핑 복원

### Fixed
- SPEC-P9-SNAKECASE-001로 인한 TS 생태계 불일치 문제 해결
- ESLint 설정과 실제 코드 간 불일치 해결

### Technical Details
- **총 변경 파일**: ~70개 (서버)
- **총 변경 건수**: ~1,700건
- **DB 마이그레이션**: 불필요 (Drizzle 매핑으로 처리)
- **API 계약 변경**: 없음 (wire format snake_case 유지)
- **테스트**: 386/386 통과 ✅
- **TypeScript**: 0 에러 ✅
- **ESLint**: 0 에러, 14 경고 (기존 any 타입) ✅
