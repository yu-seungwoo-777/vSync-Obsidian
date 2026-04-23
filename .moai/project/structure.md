# Vector - 프로젝트 구조

## 개요

Vector는 자체 호스팅 기반 지식 관리 플랫폼으로, 서버 애플리케이션(Node.js/Fastify)과 옵시디언 플러그인, 웹 인터페이스로 구성됩니다.

---

## 서버 디렉토리 구조

```
vector/
├── src/
│   ├── app.ts                      # Fastify 앱 빌더 (CORS, WS, LISTEN/NOTIFY 초기화)
│   ├── index.ts                    # 엔트리 포인트
│   ├── cli/
│   │   ├── git-sync.ts             # Git 동기화 CLI
│   │   └── migrate-storage.ts      # 스토리지 마이그레이션 CLI
│   ├── config/
│   │   ├── app.ts                  # 앱 설정 (PORT, HOST, NODE_ENV)
│   │   ├── database.ts             # PostgreSQL 연결 (postgres.js 드라이버)
│   │   └── storage.ts              # MinIO S3 클라이언트 (putObject, getObject, deleteObject)
│   ├── db/
│   │   ├── schemas/
│   │   │   ├── conflicts.ts        # conflicts 테이블 (SPEC-P5)
│   │   │   ├── device-sync-state.ts # device_sync_state 테이블
│   │   │   ├── files.ts            # files 테이블 (content, fileType 컬럼)
│   │   │   ├── file-versions.ts    # file_versions 테이블 (base_version_id, merge_type)
│   │   │   ├── index.ts            # 스키마 통합 export
│   │   │   ├── sync-events.ts      # sync_events 테이블
│   │   │   └── vaults.ts           # vaults 테이블
│   │   └── migrations/             # Drizzle Kit 마이그레이션
│   ├── routes/
│   │   └── v1.ts                   # 전체 API v1 라우트 (단일 파일)
│   ├── services/
│   │   ├── attachment.ts           # 바이너리 업로드/다운로드 (MinIO)
│   │   ├── auth.ts                 # API 키 인증 미들웨어 (bcrypt)
│   │   ├── conflict.ts             # 충돌 감지 + 해결 (SPEC-P5)
│   │   ├── export.ts               # 볼트 전체 마크다운 덤프
│   │   ├── file.ts                 # 파일 업로드 (PG + MinIO), base_hash 충돌 감지
│   │   ├── realtime-sync.ts        # 실시간 동기화 (NOTIFY -> WebSocket 브릿지)
│   │   ├── search.ts               # pg_trgm 전문 검색
│   │   ├── sync-event.ts           # 동기화 이벤트 생성 + NOTIFY
│   │   ├── three-way-merge.ts      # 3-way 자동 병합 엔진 (SPEC-P5-3WAY-001)
│   │   ├── vault.ts                # 볼트 CRUD
│   │   ├── version-cleanup.ts      # 자동 버전 정리 (최대 5개, 7일 TTL)
│   │   └── websocket.ts            # WebSocket 서버 매니저
│   ├── utils/
│   │   ├── errors.ts              # 표준 에러 코드 및 응답 형식
│   │   ├── serialize.ts           # 응답 직렬화 (camelCase → snake_case 변환 계층)
│   │   └── validation.ts          # 경로/크기 검증 유틸리티
│   └── types/
│       └── api-types.ts           # OpenAPI 명세에서 자동 생성된 API 타입
│   └── tests/                      # 19개 테스트 파일 + setup.ts (Vitest), 366개 테스트 케이스
│       ├── attachment.test.ts
│       ├── auth.test.ts
│       ├── conflict.test.ts
│       ├── edit.test.ts
│       ├── export-api.test.ts
│       ├── export.test.ts
│       ├── file-upload.test.ts
│       ├── git-sync.test.ts
│       ├── infrastructure.test.ts
│       ├── list-folder.test.ts
│       ├── migrate-storage.test.ts
│       ├── raw-md.test.ts
│       ├── realtime-sync.test.ts
│       ├── search.test.ts
│       ├── setup.ts                 # 테스트 셋업 (글로벌 설정)
│       ├── sync-api.test.ts
│       ├── sync-event-integration.test.ts
│       ├── sync-event.test.ts
│       └── websocket.test.ts
├── plugin/                          # 옵시디언 플러그인
│   ├── .editorconfig                # 코딩 스타일 규칙 (SPEC-P6-STRUCT-006)
│   ├── .gitignore                   # 빌드 산출물 제외 (SPEC-P6-STRUCT-006)
│   ├── manifest.json               # 플러그인 매니페스트
│   ├── esbuild.config.mjs          # esbuild 빌드 설정 (entry: src/main.ts)
│   ├── tsconfig.json               # 플러그인 TypeScript 설정
│   ├── vitest.config.ts            # 플러그인 테스트 설정
│   ├── package.json                # 플러그인 의존성
│   ├── src/
│   │   ├── main.ts                 # 플러그인 엔트리 포인트 (오프라인 큐 복원/stale 정리 포함)
│   │   ├── apiClient.ts            # 서버 API 클라이언트 (오프라인 큐 영속화/dedup/backoff 포함)
│   │   ├── conflict.ts             # 충돌 해결 로직 (3-way merge 지원)
│   │   ├── settings.ts             # 플러그인 설정 관리 (ObsidianSettingTab)
│   │   ├── syncEngine.ts           # 메인 동기화 엔진 (듀얼 모드 + 오프라인 큐 flush 트리거)
│   │   ├── types.ts                # TypeScript 타입 정의 (API 타입은 api-types.ts에서 import)
│   │   ├── types/
│   │   │   └── api-types.ts       # OpenAPI 명세에서 자동 생성된 API 타입
│   │   ├── services/
│   │   │   ├── pollingFallback.ts  # WebSocket 불가 시 폴링 대체
│   │   │   └── wsClient.ts         # WebSocket 클라이언트 (실시간 동기화)
│   │   └── ui/
│   │       ├── ConflictQueueView.ts     # 충돌 목록 사이드 패널 (SPEC-P6-UX-002)
│   │       ├── ConflictResolveModal.ts  # 충돌 해결 모달 UI (SPEC-P5-3WAY-001, SPEC-P6-UX-002)
│   │       └── SimpleConflictModal.ts   # 심플 충돌 선택 모달 (SPEC-P6-UX-002)
│   │   └── utils/
│   │       ├── hash.ts             # 파일 해시 유틸리티
│   │       └── path.ts             # 경로 처리 유틸리티
│   └── tests/
│       ├── mocks/
│       │   ├── obsidian.ts         # Obsidian API 모킹
│       │   └── vault.ts            # Vault 모킹
│       └── unit/
│           ├── apiClient.test.ts
│           ├── conflict.test.ts
│           ├── conflict-flow.test.ts       # 충돌 흐름 통합 테스트 (SPEC-P6-UX-002)
│           ├── conflict-queue.test.ts      # ConflictQueue 단위 테스트 (SPEC-P6-UX-002)
│           ├── conflict-queue-view.test.ts # ConflictQueueView 테스트 (SPEC-P6-UX-002)
│           ├── main.test.ts
│           ├── pollingFallback.test.ts
│           ├── settings.test.ts
│           ├── syncEngine.test.ts
│           ├── three-way-merge.test.ts  # 3-way 병합 테스트 (SPEC-P5-3WAY-001)
│           ├── types.test.ts
│           └── wsClient.test.ts
├── _reference/                      # 참고 자료
│   └── obsidian-livesync/          # CouchDB 기반 livesync 플러그인 (참고용)
├── docs/                            # 프로젝트 문서
│   ├── api/
│   │   └── openapi.yaml            # OpenAPI 3.0.3 명세 (22개 엔드포인트, 단일 소스)
│   ├── development/                 # 개발 관련 문서
│   └── obsidian/                    # Obsidian 관련 문서
├── .env.example                    # 환경 변수 템플릿
├── .mcp.json                       # MCP 서버 설정
├── drizzle.config.ts               # Drizzle ORM 설정
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 모듈 의존 관계

```
app.ts (Fastify 앱 빌더)
├── config/ (app, database, storage)
├── routes/v1.ts (전체 API 라우트)
│   ├── services/auth.ts (인증 미들웨어)
│   ├── utils/serialize.ts (응답 직렬화: camelCase → snake_case)
│   ├── services/vault.ts (볼트 생성)
│   ├── services/file.ts (파일 업로드/조회/삭제/편집/버전)
│   │   ├── config/storage.ts (MinIO)
│   │   ├── services/sync-event.ts (이벤트 생성 + NOTIFY)
│   │   ├── services/three-way-merge.ts (3-way 자동 병합)
│   │   ├── services/conflict.ts (충돌 처리)
│   │   └── services/version-cleanup.ts (버전 정리)
│   ├── services/attachment.ts (첨부파일 MinIO 연동)
│   ├── services/search.ts (pg_trgm 검색)
│   ├── services/sync-event.ts (이벤트 폴링, 디바이스 상태)
│   ├── services/export.ts (볼트 내보내기)
│   └── services/conflict.ts (충돌 목록/해결)
├── services/websocket.ts (WebSocket 서버)
└── services/realtime-sync.ts (PG NOTIFY -> WS 브릿지)
    └── services/websocket.ts
```

---

## 데이터 흐름

### 파일 업로드 (마크다운)
```
Client -> PUT /v1/vault/:id/file -> v1Routes
  -> auth.ts (API 키 검증)
  -> file.ts uploadFile()
    -> SELECT ... FOR UPDATE (race condition 방지)
    -> base_hash 불일치 감지?
        Yes -> three-way-merge.ts (3-way 자동 병합 시도)
            -> 성공: 병합 결과 저장 -> 200 { auto_merged: true }
            -> 실패: conflict.ts (충돌 파일 생성) -> 409 { diff, base_hash }
        No -> PG: files 테이블에 content 저장
    -> file_versions 버전 생성
    -> version-cleanup.ts (오래된 버전 정리)
    -> sync-event.ts (이벤트 생성 + NOTIFY)
  <- JSON 응답 (200) 또는 충돌 (409)
```

### 파일 업로드 (첨부파일)
```
Client -> PUT /v1/vault/:id/attachment/* -> v1Routes
  -> auth.ts (API 키 검증)
  -> attachment.ts uploadAttachment()
    -> MinIO: putObject() 바이너리 저장
    -> PG: files 테이블에 메타데이터 저장 (content=NULL)
  <- JSON 응답 (200)
```

### 실시간 동기화
```
Client A 업로드 -> sync-event.ts NOTIFY
  -> realtime-sync.ts (PG LISTEN 리스너)
  -> websocket.ts -> Client B에게 브로드캐스트
```
