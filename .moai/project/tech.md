# Vector - 기술 명세서

## 기술 스택

| 분야 | 기술 | 버전 |
|------|------|------|
| 런타임 | Node.js | 22 LTS |
| 언어 | TypeScript | 5.8 |
| 프레임워크 | Fastify | 5.3 |
| ORM | Drizzle ORM | 0.42 |
| DB 마이그레이션 | drizzle-kit | 0.31 |
| DB 드라이버 | postgres (postgres.js) | 3.4 |
| 데이터베이스 | PostgreSQL | 16 |
| 바이너리 저장소 | MinIO (S3 호환) | @aws-sdk/client-s3 3.780 |
| CORS | @fastify/cors | 11.0 |
| 레이트 리미트 | @fastify/rate-limit | 10.2 |
| 테스트 | Vitest | 3.1 |
| 커버리지 | @vitest/coverage-v8 | 4.1 |
| WebSocket | @fastify/websocket | 11.0 |
| 인증 | bcrypt | 5.1 |
| 유효성 검사 | Zod | 3.24 |
| 환경 변수 | dotenv | 16.5 |
| 3-way 병합 | diff-match-patch | 1.0 |
| API 명세 | OpenAPI | 3.0.3 |
| 타입 생성 | openapi-typescript | 7.13 |

---

## 데이터베이스 스키마 (Drizzle ORM, PostgreSQL)

### vaults
```typescript
export const vaults = pgTable("vaults", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### files
```typescript
export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  hash: text("hash").notNull(),
  sizeBytes: integer("size_bytes"),
  content: text("content"),                    // 마크다운 내용 (PG 직접 저장), 첨부파일은 NULL
  fileType: text("file_type").default("markdown").notNull(), // "markdown" | "attachment" | "conflict"
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("files_vault_path_uniq").on(t.vaultId, t.path)]);
```

### file_versions
```typescript
export const fileVersions = pgTable("file_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  versionNum: integer("version_num").notNull(),
  storageKey: text("storage_key").notNull(),
  contentHash: text("content_hash").notNull(),
  content: text("content"),                    // 마크다운 버전 내용, 첨부파일은 NULL
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### sync_events
```typescript
export const syncEvents = pgTable("sync_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),     // "created" | "updated" | "deleted"
  deviceId: text("device_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### device_sync_state
```typescript
export const deviceSyncState = pgTable("device_sync_state", {
  deviceId: text("device_id").notNull(),
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "cascade" }),
  lastEventId: uuid("last_event_id").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### conflicts (SPEC-P5)
```typescript
export const conflicts = pgTable("conflicts", {
  id: uuid("id").defaultRandom().primaryKey(),
  vaultId: uuid("vault_id").notNull().references(() => vaults.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  conflictPath: text("conflict_path").notNull(),
  incomingHash: text("incoming_hash").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),              // "accept" | "reject"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_conflicts_vault_unresolved").on(t.vaultId)]);
```

---

## 저장소 아키텍처

### 이중 저장 전략

| 데이터 | 저장소 | 설명 |
|--------|--------|------|
| 마크다운 내용 | PostgreSQL (files.content) | PG에 직접 저장, 검색/편집 용이 |
| 마크다운 버전 | PostgreSQL (file_versions.content) | 버전 내용도 PG에 저장 |
| 첨부파일 (이미지, PDF 등) | MinIO | S3互換 오브젝트 스토리지 |
| 파일 메타데이터 | PostgreSQL | 경로, 해시, 크기, 타입 |
| 동기화 상태 | PostgreSQL | 이벤트 로그, 디바이스 커서 |

### 버전 관리 정책
- 파일당 최대 5개 버전 유지
- 7일 이상 된 버전 자동 정리 (version-cleanup.ts)
- 마크다운은 PG에 content 필드로 저장, 첨부파일은 MinIO storageKey로 참조

---

## 실시간 동기화

### 3계층 메커니즘

**1. PostgreSQL LISTEN/NOTIFY**
- sync-event.ts에서 이벤트 생성 시 NOTIFY 발행
- realtime-sync.ts (RealtimeSyncBridge)에서 LISTEN 수신
- Vault별 채널 분리

**2. WebSocket**
- @fastify/websocket 기반 WS 서버
- 경로: `WS /ws/sync/:vaultId`
- Heartbeat: 30초 간격 (테스트 1초)
- 연결/해제 시 브릿지에 알림

**3. 폴링 폴백**
- `GET /v1/vault/:id/events?since={eventId}`
- device_sync_state 테이블로 마지막 동기화 위치 추적
- WebSocket 불가 시 클라이언트가 폴링으로 대체

---

## 인증

- API 키 기반 인증 (bcrypt 해시)
- Vault 생성 시 API 키 발급
- `X-Api-Key` 헤더로 인증
- auth.ts 미들웨어가 모든 보호 라우트에 적용

---

## 충돌 감지 및 3-way 병합 (SPEC-P5, SPEC-P5-3WAY-001)

- 파일 업로드 시 `base_hash` (또는 `X-Base-Hash` 헤더)로 낙관적 동시성 제어
- 클라이언트가 알고 있던 해시와 서버 현재 해시가 다르면 409 Conflict
- 3-way 자동 병합: diff-match-patch 기반 LCS 알고리즘으로 다른 줄 수정 시 자동 병합
- 충돌 발생 시 conflicts 테이블에 기록
- 클라이언트가 `POST /v1/vault/:id/conflicts/:conflictId/resolve`로 해결 (accept/reject)
- 클라이언트가 `POST /v1/vault/:id/conflicts/:conflictId/merge-resolve`로 3-way 병합 해결

---

## 테스트 전략

- **프레임워크**: Vitest 3.1 + coverage-v8
- **서버 테스트 파일**: 19개 (src/tests/), 366개 테스트 케이스
- **플러그인 테스트 파일**: 11개 (plugin/tests/unit/)
- **커버리지**: `npm run test:coverage` (서버), `cd plugin && npm test` (플러그인)
- **글로벌 설정**: src/tests/setup.ts

### 서버 테스트 구성 (src/tests/)
| 테스트 파일 | 대상 |
|-------------|------|
| auth.test.ts | API 키 인증 |
| file-upload.test.ts | 파일 업로드/충돌 감지 |
| raw-md.test.ts | Raw 마크다운 업로드/조회 |
| attachment.test.ts | 바이너리 첨부파일 |
| search.test.ts | pg_trgm 전문 검색 |
| edit.test.ts | 텍스트 교체 편집 |
| list-folder.test.ts | 폴더 트리 조회 |
| sync-event.test.ts | 동기화 이벤트 |
| sync-event-integration.test.ts | 이벤트 통합 테스트 |
| sync-api.test.ts | 동기화 API |
| export.test.ts | 볼트 내보내기 |
| export-api.test.ts | 내보내기 API |
| realtime-sync.test.ts | 실시간 동기화 브릿지 |
| websocket.test.ts | WebSocket 서버 |
| conflict.test.ts | 충돌 감지/해결 |
| three-way-merge.test.ts | 3-way 자동 병합 엔진 (SPEC-P5-3WAY-001) |
| batch.test.ts | 배치 연산 |
| move.test.ts | 파일 이동/이름 변경 |
| device-api.test.ts | 디바이스 관리 API |
| infrastructure.test.ts | 인프라 (DB, MinIO) |
| git-sync.test.ts | Git 동기화 CLI |
| migrate-storage.test.ts | 스토리지 마이그레이션 CLI |

### 플러그인 테스트 구성 (plugin/tests/unit/)
| 테스트 파일 | 대상 |
|-------------|------|
| apiClient.test.ts | 서버 API 클라이언트 |
| conflict.test.ts | 충돌 해결 로직 |
| main.test.ts | 플러그인 엔트리 포인트 |
| pollingFallback.test.ts | 폴링 대체 동기화 |
| settings.test.ts | 플러그인 설정 |
| syncEngine.test.ts | 메인 동기화 엔진 |
| three-way-merge.test.ts | 3-way 병합 처리 (SPEC-P5-3WAY-001) |
| types.test.ts | 타입 정의 검증 |
| wsClient.test.ts | WebSocket 클라이언트 |
| conflict-flow.test.ts | 충돌 흐름 통합 테스트 (SPEC-P6-UX-002) |
| conflict-queue.test.ts | ConflictQueue 단위 테스트 (SPEC-P6-UX-002) |
| conflict-queue-view.test.ts | ConflictQueueView 테스트 (SPEC-P6-UX-002) |
| hash.test.ts | 파일 해시 유틸리티 |
| path.test.ts | 경로 처리 유틸리티 |

---

## 환경 변수

```env
# .env.example 참조
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/obsidiansync
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=vaults
MINIO_USE_SSL=false
```

---

## 스크립트

```bash
npm run dev            # 개발 서버 (tsx watch)
npm run build          # TypeScript 빌드
npm run start          # 프로덕션 실행
npm test               # 테스트 실행
npm run test:watch     # 테스트 와치 모드
npm run test:coverage  # 커버리지 리포트
npm run db:generate    # 마이그레이션 생성
npm run db:migrate     # 마이그레이션 실행
npm run db:push        # 스키마 푸시
npm run db:studio      # Drizzle Studio
npm run lint           # ESLint
npm run typecheck      # 타입 체크
npm run generate:all   # OpenAPI → 서버/플러그인 타입 동시 생성
npm run generate-types # 서버 API 타입만 생성
npm run generate-types:plugin # 플러그인 API 타입만 생성
```
