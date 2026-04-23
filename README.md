# Vector

자체 호스팅 기반 지식 관리 플랫폼. PostgreSQL + MinIO를 사용해 마크다운 파일과 첨부파일을 관리하고, 실시간 WebSocket + LISTEN/NOTIFY로 다중 디바이스 동기화를 지원합니다.

## 기술 스택

- **Node.js 22 LTS** + **TypeScript 5.8**
- **Fastify 5.3** (HTTP 프레임워크)
- **Drizzle ORM 0.42** + PostgreSQL 16
- **MinIO** (S3 호환 바이너리 저장소)
- **Vite + React 19** (웹 클라이언트)
- **Vitest 3.1** (테스트)
- **OpenAPI 3.0.3** (API 명세)

## 모노레포 구조

```
vector/
├── packages/
│   ├── server/      # @vector/server - Fastify 동기화 서버
│   ├── plugin/      # @vector/plugin - Obsidian 플러그인
│   └── web/         # @vector/web - 웹 클라이언트
├── docs/            # API 명세 (OpenAPI)
└── package.json     # 워크스페이스 루트
```

## 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정
cp .env.example .env
# .env 파일을 실제 환경에 맞게 수정

# 3. PostgreSQL 및 MinIO 실행 (별도 구성 필요)
# PostgreSQL 16 + pg_trgm 확장 활성화
# MinIO 서버 실행 (버킷: vaults)

# 4. 데이터베이스 마이그레이션
npm run db:migrate -w packages/server

# 5. 개발 서버 실행
npm run dev
```

## API 개요

API 명세는 `docs/api/openapi.yaml`에 OpenAPI 3.0.3 형식으로 정의되어 있습니다. 모든 JSON 응답 필드는 **snake_case** 규칙을 따릅니다.

### 타입 생성

```bash
npm run generate-types    # 서버 + 플러그인 타입 생성
```

### 볼트 관리

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/v1/vault` | 볼트 생성 (API 키 발급) |

### 파일 조작

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `PUT` | `/v1/vault/:id/file` | 파일 업로드/수정 (JSON) |
| `GET` | `/v1/vault/:id/file/*` | 파일 조회 |
| `DELETE` | `/v1/vault/:id/file/*` | 파일 소프트 삭제 |
| `PUT` | `/v1/vault/:id/raw/*` | Raw 마크다운 업로드 |
| `GET` | `/v1/vault/:id/raw/*` | Raw 마크다운 다운로드 |
| `PUT` | `/v1/vault/:id/attachment/*` | 바이너리 첨부파일 업로드 |
| `GET` | `/v1/vault/:id/attachment/*` | 바이너리 첨부파일 다운로드 |
| `GET` | `/v1/vault/:id/files` | 파일 목록 조회 |
| `GET` | `/v1/vault/:id/versions/*` | 버전 히스토리 조회 |
| `POST` | `/v1/vault/:id/edit` | 텍스트 교체 편집 |
| `GET` | `/v1/vault/:id/list` | 폴더 트리 조회 |
| `GET` | `/v1/vault/:id/search` | 전문 검색 (pg_trgm) |
| `GET` | `/v1/vault/:id/export` | 볼트 전체 마크다운 덤프 |

### 동기화

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/v1/vault/:id/events` | 이벤트 폴링 (since 파라미터) |
| `PUT` | `/v1/vault/:id/sync-status` | 디바이스 동기화 상태 업데이트 |
| `WS` | `/ws/sync/:vaultId` | WebSocket 실시간 동기화 |

### 충돌 관리

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/v1/vault/:id/conflicts` | 미해결 충돌 목록 |
| `POST` | `/v1/vault/:id/conflicts/:conflictId/resolve` | 충돌 해결 (accept/reject) |
| `POST` | `/v1/vault/:id/conflicts/:conflictId/merge-resolve` | 수동 3-way merge 해결 |

### 디바이스 관리

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/v1/vault/:id/devices` | 디바이스 목록 |
| `DELETE` | `/v1/vault/:id/devices/:deviceId` | 디바이스 제거 |

### 배치/이동

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/v1/vault/:id/batch` | 배치 연산 (create/delete) |
| `POST` | `/v1/vault/:id/move` | 파일 이동/이름 변경 |

### 기타

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스 체크 |

## 인증

모든 볼트 조작 API는 `X-Api-Key` 헤더가 필요합니다. 볼트 생성 시 발급된 API 키를 사용합니다.

## 환경 변수

`.env.example` 파일을 참조하여 설정:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vector
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=vaults
MINIO_USE_SSL=false
```

## 스크립트

```bash
npm run dev            # 서버 개발 모드
npm run dev:web        # 웹 개발 모드
npm run build          # 전체 빌드
npm test               # 전체 테스트
npm run lint           # ESLint
npm run generate-types # OpenAPI → 서버/플러그인 타입 생성
```
