# Vector 로컬 개발 환경 구축 가이드

---

## 0. 설계 철학

이 프로젝트의 모든 기술 선택은 아래 원칙에서 출발한다.

### 0.1 PostgreSQL을 단일 진실 공급원으로

CouchDB, Redis, Kafka 등 외부 메시지 브로커를 배제하고 PostgreSQL 하나로 메타데이터, 이벤트 로그, 실시간 push(LISTEN/NOTIFY), 전문 검색(pg_trgm)까지 모두 처리한다. 인프라 구성요소가 적을수록 장애 포인트가 줄고, 운용자의 인지 부하가 낮아진다.

**함의:** 실시간 통신에 Redis Pub/Sub이나 Kafka가 필요 없다. sync_events 테이블이 영구 이벤트 로그 역할을 겸하므로, NOTIFY가 유실되더라도 폴링으로 항상 복구할 수 있다. 이 이원화(push + pull)가 시스템의 신뢰성을 보장한다.

### 0.2 메타데이터와 바이너리의 분리 저장

파일 내용은 MinIO(S3 호환)에, 파일의 메타데이터(경로, 해시, 크기, 버전)는 PostgreSQL에 저장한다. 관계형 데이터베이스는 구조화된 메타데이터의 조회, 인덱싱, 조인에 최적화되어 있지만, 대용량 바이너리를 행 데이터로 관리하기에는 부적합하다.

**함의:** 파일 목록 조회나 검색은 PostgreSQL만으로 가볍게 처리되고, 실제 파일 내용은 필요한 순간에만 MinIO에서 가져온다. 백업과 용량 관리도 메타데이터와 바이너리를 독립적으로 수행할 수 있다.

### 0.3 로컬 개발 환경과 프로덕션의 동일성

Docker Compose는 배포 단계에서 도입한다. 로컬 개발 단계에서는 PostgreSQL과 MinIO를 네이티브 또는 단일 컨테이너로 실행하고, Fastify 서버는 `npm run dev`로 직접 구동한다. 개발자가 Docker 네트워킹, 볼륨 마운트, 컨테이너 로그 등을 디버깅하는 데 시간을 쓰지 않도록 한다.

**함의:** 프로덕션에서는 전체 서비스가 Docker Compose로 오케스트레이션되지만, 로컬에서는 최소한의 외부 의존성(PostgreSQL, MinIO)만 필요하다. 애플리케이션 코드는 환경에 관계없이 동일하게 동작한다.

### 0.4 해시 기반 동기화

파일 동기화의 기본 단위는 내용 해시(SHA-256)다. 타임스탬프나 파일 크기만으로 변경을 판단하지 않고, 실제 내용의 해시를 비교하여 동일 파일의 중복 업로드를 방지한다.

**함의:** 클라이언트(플러그인 또는 LLM)는 업로드 전에 해시를 계산하여 서버에 전달하고, 서버는 기존 해시와 비교하여 변경이 없으면 MinIO 업로드를 생략한다. 이것이 불필요한 네트워크 I/O와 스토리지 사용을 줄이는 핵심 메커니즘이다.

### 0.5 LLM은 특별한 클라이언트가 아니다

LLM Tool Use 호출은 별도의 MCP 레이어나 특권 API 없이, Obsidian 플러그인과 동일한 REST API를 사용한다. `device_id`를 `llm-agent`로 구분하는 것 외에 아무런 차이가 없다.

**함의:** LLM이 작성한 파일은 일반 클라이언트 업로드와 동일한 경로로 처리되어 sync_events에 INSERT되고, LISTEN/NOTIFY로 모든 디바이스에 즉시 전파된다. AI 접근 레이어가 시스템에 부가적인 복잡도를 더하지 않는다.

### 0.6 타입 안전성을 아키텍처의 일부로

Drizzle ORM은 컴파일 타임에 SQL 쿼리를 검증한다. 런타임에 스키마 불일치로 실패하는 것보다, 빌드 시점에 잡히는 것이 낫다. 이 원칙은 ORM 선택에만 국한되지 않고, Zod를 통한 API 입력 검증, TypeScript strict 모드 등 프로젝트 전반에 일관되게 적용된다.

**함의:** `tsc --noEmit`이 통과하면 데이터베이스 스키마와 TypeScript 타입이 동기화되어 있음을 의미한다. 이것이 CI의 첫 번째 게이트가 된다.

### 0.7 API 명세 기반 타입 동기화

API 응답 타입은 `docs/api/openapi.yaml` (OpenAPI 3.0.3)에서 단일 소스로 관리된다. 서버와 플러그인 모두 `openapi-typescript`로 이 명세에서 타입을 자동 생성하므로, 수동 동기화로 인한 불일치가 발생하지 않는다.

**함의:** API 필드를 추가/변경하려면 `openapi.yaml`을 수정한 뒤 `npm run generate:all`을 실행하면 서버(`src/types/api-types.ts`)와 플러그인(`plugin/src/types/api-types.ts`)의 타입이 동시에 갱신된다. 명세가 곧 계약(contract)이다.

### 0.8 JSON 응답 snake_case 규칙

모든 API JSON 응답 필드는 **snake_case**를 사용한다 (`size_bytes`, `created_at`, `event_type`, `file_path` 등). 서버 내부 TypeScript 코드는 camelCase를 유지하며, 라우트 핸들러의 직렬화 계층(`src/utils/serialize.ts`)이 변환을 담당한다. PostgreSQL 컬럼명도 snake_case이므로 DB-JSON 간 변환이 필요 없다.

**함의:** 플러그인은 생성된 타입(`api-types.ts`)을 그대로 사용하면 서버 응답과 필드명이 정확히 일치한다. 명명 규칙에 대한 추측이나 수동 매핑이 필요 없다.

---

## 1. 사전 요구사항

| 도구 | 버전 | 용도 |
|------|------|------|
| Node.js | 22 LTS | 서버 런타임 |
| PostgreSQL | 16+ | 메타데이터 DB, LISTEN/NOTIFY |
| MinIO | 최신 | 파일 바이너리 오브젝트 스토리지 |

## 2. 프로젝트 구조

```
vector/
├── packages/
│   ├── server/                  # Fastify 서버
│   │   ├── src/
│   │   │   ├── index.ts                 # 서버 실행 진입점
│   │   │   ├── app.ts                   # Fastify 앱 빌더 (테스트 가능한 구조)
│   │   │   ├── config/                  # 환경 설정
│   │   │   │   ├── app.ts               # PORT, HOST
│   │   │   │   ├── database.ts          # DATABASE_URL
│   │   │   │   └── storage.ts           # MinIO 설정
│   │   │   ├── db/
│   │   │   │   └── schemas/             # Drizzle ORM 스키마
│   │   │   │       ├── vaults.ts        # 볼트 (id, name, api_key_hash)
│   │   │   │       ├── files.ts         # 파일 메타데이터 (vault_id, path, hash)
│   │   │   │       ├── file-versions.ts # 버전 히스토리 (storage_key → MinIO)
│   │   │   │       ├── sync-events.ts   # 변경 이벤트 로그 (NOTIFY 트리거 대상)
│   │   │   │       └── device-sync-state.ts  # 디바이스 sync 커서
│   │   │   ├── routes/                  # API 라우트
│   │   │   ├── services/                # 비즈니스 로직
│   │   │   ├── utils/                   # 공통 유틸리티
│   │   │   │   └── serialize.ts         # 응답 직렬화 (camelCase → snake_case)
│   │   │   └── types/                   # TypeScript 타입
│   │   │       └── api-types.ts         # OpenAPI에서 자동 생성된 타입
│   │   └── ...
│   ├── plugin/                  # Obsidian 플러그인
│   └── web/                     # 웹 인터페이스
├── docs/api/                    # OpenAPI 3.0.3 명세
│   └── openapi.yaml             # API 단일 소스 (22개 엔드포인트)
├── .moai/project/               # 프로젝트 문서 (product, structure, tech)
├── drizzle.config.ts            # Drizzle Kit 마이그레이션 설정
└── package.json                 # 워크스페이스 루트 설정
```

**구조 철학:** `app.ts`가 `buildApp()` 팩토리 함수를 export하는 이유는 테스트에서 서버를 직접 기동하지 않고 Fastify 인스턴스만 주입받기 위해서다. `index.ts`는 오직 서버를 실행하는 역할만 담당한다.

## 3. 초기 설정

### 3.1 저장소 클론 및 의존성 설치

```bash
git clone <repo-url> && cd vector
npm install
```

### 3.2 환경 변수 구성

```bash
cp .env.example .env
```

`.env` 파일 편집:

```env
# 서버
PORT=3000
NODE_ENV=development

# PostgreSQL — 로컬 설치 또는 Docker 사용
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vector

# MinIO — 로컬 설치 또는 Docker 사용
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=vaults
MINIO_USE_SSL=false
```

**환경 변수 원칙:** 모든 설정은 환경 변수로 외부화한다. 코드에 하드코딩된 기본값은 개발 편의를 위한 것뿐이며, 프로덕션에서는 반드시 명시적으로 설정해야 한다. `.env` 파일은 절대 커밋하지 않는다.

### 3.3 PostgreSQL 설정

**옵션 A: 로컬 설치**

```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16

# Ubuntu
sudo apt install postgresql-16

# 데이터베이스 생성
createdb vector

# pg_trgm 확장 활성화 (전문 검색용)
psql vector -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

**옵션 B: Docker 단일 실행**

```bash
docker run -d \
  --name vector-postgres \
  -e POSTGRES_DB=vector \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16

# pg_trgm 확장
docker exec vector-postgres psql -U postgres -d vector \
  -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

**pg_trgm이 필요한 이유:** 파일명 및 파일 내용 검색을 위한 트라이그램 인덱스. Elasticsearch나 Meilisearch 같은 별도 검색엔진 없이 PostgreSQL 확장만으로 전문 검색을 수행한다(철학 0.1과 일관됨).

### 3.4 MinIO 설정

**옵션 A: 로컬 설치**

```bash
# macOS
brew install minio/stable/minio && minio server /tmp/minio-data --console-address ":9001"

# Ubuntu (바이너리)
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio && ./minio server /tmp/minio-data --console-address ":9001"
```

**옵션 B: Docker 단일 실행**

```bash
docker run -d \
  --name vector-minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -p 9000:9000 \
  -p 9001:9001 \
  minio/minio server /data --console-address ":9001"
```

**버킷 생성** (최초 1회):

```bash
# MinIO 콘솔: http://localhost:9001 (minioadmin/minioadmin)
# 또는 mc CLI:
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/vaults
```

**MinIO를 선택한 이유:** AWS S3와 API 호환되므로, 향후 클라우드 스토리지로 마이그레이션이 필요한 경우 애플리케이션 코드 변경 없이 엔드포인트만 교체하면 된다. 셀프호스팅 환경에서 데이터를 외부에 보내지 않는다(철학 0.2).

### 3.5 데이터베이스 스키마 동기화

```bash
# Drizzle Kit으로 스키마를 DB에 직접 반영 (개발용)
npm run db:push

# 또는 마이그레이션 파일 생성 후 적용
npm run db:generate
npm run db:migrate
```

**개발 vs 프로덕션:** 개발 중에는 `db:push`로 빠르게 반복하고, 프로덕션 배포 시에는 `db:generate` + `db:migrate`로 제어된 마이그레이션을 수행한다. `src/db/schemas/`에 정의된 TypeScript 코드가 스키마의 단일 진실 공급원이다(철학 0.6).

### 3.6 인프라 연결 검증

설정 완료 후 인프라 테스트로 PostgreSQL, MinIO 연결과 스키마 상태를 한 번에 검증한다.

```bash
npm run test -- src/tests/infrastructure.test.ts
```

6개 테스트가 모두 통과하면 개발 환경 준비 완료:

| 테스트 항목 | 검증 내용 |
|------------|----------|
| DB 연결 | `SELECT 1` 쿼리 응답 |
| pg_trgm 확장 | 전문 검색용 확장 설치 여부 |
| 스키마 테이블 | 5개 테이블(vaults, files, file_versions, sync_events, device_sync_state) 존재 |
| MinIO 연결 | S3 호환 엔드포인트 응답 |
| vaults 버킷 | 버킷 존재 여부 |
| ensureBucket | 버킷 자동 생성 로직 |

테스트가 실패하면: PostgreSQL/MinIO 실행 상태, `.env` 연결 정보, pg_trgm 설치 여부를 확인한다.

### 3.7 개발 서버 실행

```bash
npm run dev
```

정상 동작 확인:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

## 4. 개발 명령어

| 명령어 | 용도 |
|--------|------|
| `npm run dev` | 개발 서버 (tsx watch, 파일 변경 시 자동 재시작) |
| `npm run build` | TypeScript → dist/ 빌드 |
| `npm run typecheck` | 타입 검사 (빌드 없이) — CI 첫 번째 게이트 |
| `npm run test` | 전체 테스트 실행 |
| `npm run test:watch` | 테스트 워치 모드 |
| `npm run test:coverage` | 커버리지 리포트 생성 |
| `npm run db:push` | 스키마를 DB에 직접 반영 |
| `npm run db:generate` | 마이그레이션 SQL 파일 생성 |
| `npm run db:migrate` | 마이그레이션 적용 |
| `npm run db:studio` | Drizzle Studio (DB 브라우저 GUI) |
| `npm run generate:all` | OpenAPI → 서버/플러그인 타입 동시 생성 |
| `npm run generate-types` | 서버 API 타입만 생성 |
| `npm run generate-types:plugin` | 플러그인 API 타입만 생성 |

## 5. 데이터베이스 스키마

5개 핵심 테이블:

```
vaults ──< files ──< file_versions
  │
  ├──< sync_events
  └──< device_sync_state
```

| 테이블 | 스키마 파일 | 용도 |
|--------|------------|------|
| `vaults` | `src/db/schemas/vaults.ts` | 볼트 단위 격리, API Key 해시 |
| `files` | `src/db/schemas/files.ts` | 파일 메타데이터 (내용은 MinIO) |
| `file_versions` | `src/db/schemas/file-versions.ts` | 버전 히스토리, MinIO 키 참조 |
| `sync_events` | `src/db/schemas/sync-events.ts` | 변경 이벤트 로그 (NOTIFY 트리거) |
| `device_sync_state` | `src/db/schemas/device-sync-state.ts` | 디바이스별 sync 커서 |

**스키마 설계 원칙:**

- `sync_events`는 append-only 이벤트 로그다. UPDATE/DELETE가 없으며, 이벤트의 시간순 보장이 동기화의 정확성을 담보한다.
- `files`의 `deleted_at` 컬럼은 soft delete를 구현한다. 삭제된 파일도 버전 히스토리에서 복구할 수 있어야 한다.
- `device_sync_state.last_event_id`가 폴링 복구의 기준점이다. 이 값 이후의 sync_events를 조회하여 누락된 이벤트를 복구한다.

스키마 변경 시:

1. `src/db/schemas/` 내 파일 수정
2. `npm run db:generate` — 마이그레이션 SQL 생성
3. `npm run db:migrate` — DB에 적용

개발 중에는 `npm run db:push`로 직접 반영이 빠름.

## 6. 아키텍처 개요

```
Obsidian Plugin ←── WebSocket ──→ Fastify Server ←── REST API ──→ LLM Tool Use
        │                              │
        └── REST API (fallback)        ├── PostgreSQL (메타데이터 + LISTEN/NOTIFY)
                                       └── MinIO (파일 바이너리)
```

**실시간 전략 (3중):**

1. PostgreSQL LISTEN/NOTIFY → Fastify → WebSocket push (정상)
2. sync_events 테이블 폴링 (WS 끊김 시 복구)
3. Exponential backoff 재연결 (모바일 네트워크)

이 세 가지가 계층적으로 동작한다. 정상 시에는 (1)만 사용되고, WS가 끊기면 (3)으로 재연결을 시도하면서 (2)로 누락 이벤트를 복구한다. 이중화가 아닌 삼중화이며, 세 가지 메커니즘이 서로 다른 장애 모드를 커버한다.

**인증:** API Key + bcrypt (볼트별 키, `X-API-Key` 헤더). JWT의 Refresh Token 로테이션, 만료 관리, 토큰 탈취 대응 등의 복잡도를 도입하지 않는다. 싱글유저 셀프호스팅 환경에서 API Key 하나로 충분하다.

## 7. 개발 로드맵 (PRD 기준)

| Phase | 명칭 | 핵심 작업 | 산출물 | 상태 |
|-------|------|----------|--------|------|
| P0 | MD→DB 검증 | PUT/GET 엔드포인트, 해시 비교 | MD 파일 저장/조회 확인 | Done |
| P1 | Foundation | 전체 스키마, MinIO, Docker Compose | 인프라 기반 완성 | Done |
| P2 | API Core | REST 전체 엔드포인트, 인증, 검색 | CRUD + 버전 + 검색 | Done |
| P3 | Realtime | LISTEN/NOTIFY, WebSocket, 폴링 | 실시간 동기화 | Done |
| P4 | Plugin MVP | Obsidian 플러그인 기본 동작 | 업로드/다운로드/WS | Done |
| P5 | Conflict | 충돌 감지, Conflict 파일 | 충돌 해결 로직 | Done |
| P6 | LLM Access | Tool Use 문서화, vault_search | AI 접근 레이어 | Done |
| P7 | Polish | 설정 UI, StatusBar, 모니터링 | 프로덕션 준비 | Done |
| P8 | OpenAPI | API 명세, 타입 자동 생성, snake_case 표준화 | API 계약 일원화 | Done |

**P0의 의미:** 전체 시스템이 "마크다운 파일을 PostgreSQL에 저장하고 다시 꺼내올 수 있는가?"라는 질문에 답하는 것이 가장 먼저 할 일이다. 이것이 검증되지 않으면 이후의 모든 레이어가 의미가 없다.

## 8. 테스트 전략

- **프레임워크:** Vitest
- **커버리지 목표:** 85%+
- **테스트 유형:**
  - 단위 테스트: `src/**/*.test.ts` (서비스, 유틸리티)
  - 통합 테스트: 실제 PostgreSQL + MinIO 대상
  - E2E 테스트: 전체 동기화 워크플로우

**테스트 철학:** 통합 테스트는 mock을 사용하지 않고 실제 PostgreSQL과 MinIO에 연결한다. Drizzle ORM의 타입 안전성이 컴파일 타임 검증을 담당하고, 통합 테스트가 런타임 검증을 담당한다. 두 가지가 모두 통과해야 신뢰할 수 있다.

**테스트 범위 제어:** 테스트가 불필요한 파일을 포함하지 않도록 `vitest.config.ts`의 `exclude` 항목으로 제어한다:

```ts
test: {
  exclude: [
    "node_modules/**",
    "dist/**",
    "coverage/**",
    "_reference/**",
    ".moai/**",
    ".claude/**",
    "plugin/**",
  ],
  coverage: {
    exclude: [
      "src/index.ts",
      "src/types/**",
      "src/db/migrations/**",
      "**/*.d.ts",
    ],
  },
}
```

**원칙:** 테스트는 `src/` 코드만 대상으로 한다. 빌드 산출물, 참고 구현체, 설정 파일, 마이그레이션 파일은 테스트 범위에서 명시적으로 제외한다. 이 제어는 `.claudeignore` 같은 외부 파일이 아닌 `vitest.config.ts` 자체에서 수행한다.

- 테스트 DB는 `.env`의 `DATABASE_URL` 사용
- 통합 테스트는 PostgreSQL 실행 상태에서만 동작
