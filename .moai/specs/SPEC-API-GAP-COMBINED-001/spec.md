---
id: SPEC-API-GAP-COMBINED-001
version: "1.0"
status: completed
created: "2026-04-21"
updated: "2026-04-21"
author: manager-spec
priority: high
issue_number: null
---

# SPEC-API-GAP-COMBINED-001: Plugin/Server 아키텍처 개선 및 경쟁 상태 수정

## 이력

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| 2026-04-21 | 1.0 | 최초 작성 - Plugin 1건 + Server 4건, 총 5개 이슈 통합 SPEC | manager-spec |

## 배경 및 컨텍스트

VSync는 Obsidian plugin과 Fastify server가 PostgreSQL(MinIO 바이너리 스토리지)와 함께 동작하는 파일 동기화 시스템이다. 코드 리뷰 결과 plugin과 server 양쪽에 걸쳐 5개의 아키텍처/안정성 이슈가 식별되었다.

### 대상 패키지

- `packages/plugin/` - Obsidian plugin (TypeScript)
- `packages/server/` - Fastify server (TypeScript, Drizzle ORM, MinIO)

### 관련 기존 SPEC

- `SPEC-OBSIDIAN-API-GAP-001` (completed) - Obsidian Vault API 공식 메서드 전환

---

## 요구사항

### REQ-PLG-001: Obsidian 내장 normalizePath 사용 (MEDIUM)

**상태**: Plugin 패키지

현재 `packages/plugin/src/utils/path.ts`에 커스텀 `normalizePath()`가 구현되어 있다. Obsidian API가 동일한 동작의 `normalizePath`를 `obsidian` 모듈에서 제공한다. 커스텀 구현을 제거하고 Obsidian 내장 함수로 교체해야 한다.

> **When** `packages/plugin/src/utils/path.ts`에서 `normalizePath` 함수를 제거하고, **the system shall** `packages/plugin/src/sync-engine.ts`의 모든 `normalizePath` import를 `import { normalizePath } from 'obsidian'`으로 변경한다.

> **The system shall** `validateVaultPath`, `shouldSyncPath`, `isObsidianPath`, `isBinaryPath`, `getExtension`, `isConflictFile`, `isTrashPath`, `ALLOWED_EXTENSIONS` 등 path.ts의 나머지 유틸리티 함수와 상수를 변경 없이 유지한다.

> **The system shall** server 측 코드는 Obsidian API에 접근할 수 없으므로 server의 경로 정규화 로직을 변경하지 않는다.

#### 제약사항

- `sync-engine.ts`에서 `normalizePath`를 제외한 나머지 import (`shouldSyncPath`, `isObsidianPath`, `isBinaryPath`)는 `./utils/path`에서 계속 import한다.
- Obsidian의 `normalizePath`는 역슬래시 변환, 중복 슬래시 제거, 선행 슬래시 제거를 모두 수행하므로 기능적 동등성이 보장된다.

---

### REQ-SRV-001: S3 클라이언트 싱글턴 패턴 도입 (HIGH)

**상태**: Server 패키지

현재 `packages/server/src/config/storage.ts`의 `putObject`, `getObject`, `deleteObject`는 매 호출마다 `createS3Client()`를 호출하여 새로운 S3Client 인스턴스를 생성한다. 이는 매 요청마다 새 TCP 연결을 생성하며 커넥션 풀링이 전혀 이루어지지 않는다.

> **When** 서버가 시작되면, **the system shall** S3Client 싱글턴 인스턴스를 한 번만 생성하여 `putObject`, `getObject`, `deleteObject`의 모든 런타임 호출에서 재사용한다.

> **The system shall** `ensureBucket()`은 초기화 시점에 별도의 임시 S3Client를 사용할 수 있도록 허용한다. 단, 버킷 존재 확인 이후 런타임 작업은 싱글턴 클라이언트를 사용한다.

> **If** `createS3Client()`가 런타임에 재호출되면, **then the system shall** 기존 싱글턴 인스턴스를 반환하거나 명시적으로 재초기화된 경우에만 새 인스턴스를 생성한다.

#### 제약사항

- `@aws-sdk/client-s3`의 `S3Client`는 자체적으로 HTTP 연결 풀링을 관리한다. 싱글턴을 유지하면 연결 재사용이 자동으로 이루어진다.
- `ensureBucket()`은 서버 시작 시에만 호출되므로, 임시 클라이언트 사용이 허용된다.

---

### REQ-SRV-002: FOR UPDATE 트랜잭션 래핑 (HIGH)

**상태**: Server 패키지

`packages/server/src/services/file.ts`의 `uploadFile` 함수에서 `SELECT ... FOR UPDATE`로 행 락을 획득하지만, 후속 DB 작업(3-way merge, 파일 업데이트, 버전 생성, 동기화 이벤트 생성)이 트랜잭션 밖에서 실행된다. 행 락은 SELECT 직후 해제되어 락의 목적이 상실된다.

> **When** `uploadFile`에서 baseHash 충돌이 감지되어 3-way merge를 시도할 때, **the system shall** `SELECT ... FOR UPDATE`부터 merge 결과 저장, 버전 생성, 동기화 이벤트 생성까지의 전체 흐름을 단일 데이터베이스 트랜잭션으로 래핑한다.

> **The system shall** Drizzle ORM의 `db.transaction(async (tx) => { ... })` API를 사용하여 트랜잭션을 구현한다.

> **If** 트랜잭션 내의 어떤 작업이든 실패하면, **then the system shall** 전체 트랜잭션을 롤백하고 에러를 상위로 전파한다.

#### 제약사항

- Drizzle ORM의 `db.transaction()`은 콜백 내에서 `tx` 객체를 제공하며, 콜백 내의 모든 DB 작업은 `tx`를 통해 수행되어야 한다.
- MinIO(`putObject`) 작업은 DB 트랜잭션 외부에 위치할 수 있다. MinIO는 2-phase commit을 지원하지 않기 때문이다. 단, DB 작업은 반드시 트랜잭션 내에 있어야 한다.

---

### REQ-SRV-003: 업로드 경쟁 상태 원자적 처리 (MEDIUM)

**상태**: Server 패키지

`uploadFile`에서 `findFileByPath`로 기존 파일 조회 후, 결과에 따라 신규 생성 또는 업데이트를 수행하는 로직이 비원자적이다. 두 개의 동시 업로드가 동일 파일에 대해 모두 "기존 파일 없음"으로 판단하면 중복 레코드가 생성될 수 있다.

DB 스키마(`files_vault_path_uniq`)에 `UNIQUE INDEX`가 이미 존재하지만, 두 번째 INSERT가 에러 없이 무시되거나 적절히 처리되어야 한다.

> **When** 동일한 (vaultId, path)에 대해 두 개의 동시 업로드가 발생하면, **the system shall** `files_vault_path_uniq` 유니크 제약을 통해 중복을 방지하고, 두 번째 요청은 기존 파일에 대한 업데이트로 처리한다.

> **The system shall** 신규 파일 INSERT 시 `ON CONFLICT (vault_id, path) DO NOTHING` 또는 `ON CONFLICT DO UPDATE` upsert 패턴을 사용하여 경쟁 상태를 원자적으로 처리한다.

> **If** upsert 결과가 INSERT가 아닌 충돌(conflict)로 처리된 경우, **then the system shall** 기존 레코드를 재조회하여 업데이트 경로로 처리한다.

#### 제약사항

- `files` 테이블의 `files_vault_path_uniq` UNIQUE INDEX가 이미 `(vault_id, path)`에 정의되어 있다.
- Drizzle ORM은 `onConflictDoNothing()` 및 `onConflictDoUpdate()` 메서드를 지원한다.
- `deletedAt`이 설정된 파일의 경우, 동일 path로 재업로드 시 복원(update) 경로로 처리되어야 한다.

---

### REQ-SRV-004: 서버 경로 정규화 유틸리티 통합 (LOW)

**상태**: Server 패키지

`packages/server/src/services/file.ts`의 `listFolder` 함수에서 `folder.replace(/^\/+|\/+$/g, "")`와 같은 인라인 경로 정규화가 사용되고 있다. 유사한 정규화 로직이 여러 곳에 산재될 수 있으며, 일관된 동작을 보장하기 위해 공통 유틸리티로 추출해야 한다.

> **The system shall** `packages/server/src/utils/` 디렉토리에 `path.ts` 파일을 생성하고, `normalizePath(path: string): string` 함수를 정의하여 인라인 경로 정규화를 대체한다.

> **When** server 코드에서 파일 경로 정규화가 필요한 경우, **the system shall** 인라인 regex 대신 `normalizePath` 유틸리티 함수를 사용한다.

> **The system shall** `normalizePath` 유틸리티는 (1) 선행/후행 슬래시 제거, (2) 중복 슬래시 제거를 수행한다. 역슬래시 처리는 server가 Linux 환경에서 실행되므로 제외할 수 있다.

#### 제약사항

- Plugin의 Obsidian `normalizePath`와는 독립적인 server 전용 구현이다.
- 기존 인라인 정규화와 동일한 결과를 생성해야 한다 (회귀 방지).

---

## 의존성 관계

```
REQ-PLG-001 (Plugin normalizePath) -- 독립적, plugin에만 적용
REQ-SRV-001 (S3 싱글턴) -- REQ-SRV-002, REQ-SRV-003과 무관
REQ-SRV-002 (FOR UPDATE 트랜잭션) -- REQ-SRV-003과 밀접, 함께 수정 권장
REQ-SRV-003 (업로드 경쟁 상태) -- REQ-SRV-002와 동일 함수(uploadFile) 수정
REQ-SRV-004 (서버 경로 정규화) -- 독립적, REQ-PLG-001과 무관
```

### 수정 순서 권장

1. REQ-SRV-004: path.ts 유틸리티 생성 (다른 REQ에서 참조 가능)
2. REQ-PLG-001: Plugin normalizePath 교체 (독립적)
3. REQ-SRV-001: S3 싱글턴 (독립적)
4. REQ-SRV-002 + REQ-SRV-003: uploadFile 트랜잭션 + upsert (동시 수정)

---

## 제외 범위 (What NOT to Build)

- Plugin의 `validateVaultPath`, `shouldSyncPath` 등 다른 유틸리티 함수는 이 SPEC의 범위를 벗어난다.
- Server의 MinIO 설정값(endpoint, port, credentials) 변경은 포함하지 않는다.
- Server의 API 라우트(routes) 변경은 포함하지 않는다.
- 데이터베이스 마이그레이션 새성은 포함하지 않는다 (UNIQUE INDEX가 이미 존재함).
- Plugin의 Obsidian API 버전 업그레이드는 포함하지 않는다.
- MinIO 작업(putObject 등)의 트랜잭션 래핑은 포함하지 않는다 (2PC 미지원).
