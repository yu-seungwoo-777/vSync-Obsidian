---
spec_id: SPEC-WEB-001
title: Vector 웹 관리 인터페이스 구현 계획
version: 1.0.0
status: Planned
---

## 구현 계획 (Implementation Plan)

### Phase 1: DB 스키마 변경

**목표**: 관리자 인증 및 API 키 미리보기를 위한 DB 스키마 추가

**변경 사항**:

| 파일 | 변경 내용 |
|------|-----------|
| `packages/server/src/db/schema/admin-credentials.ts` | 신규 — `admin_credentials` 테이블 정의 (id, username, password_hash, createdAt) |
| `packages/server/src/db/schema/index.ts` | 수정 — admin-credentials export 추가 |
| `packages/server/src/db/migrations/XXXX_add_admin_credentials.ts` | 신규 — admin_credentials 마이그레이션 |
| `packages/server/src/db/migrations/XXXX_add_vault_api_key_preview.ts` | 신규 — vaults 테이블에 `api_key_preview` 컬럼 추가 |

**기술 상세**:
- `admin_credentials` 테이블: `id` (uuid, PK), `username` (varchar(255), unique), `password_hash` (varchar(255)), `created_at` (timestamp)
- `vaults` 테이블 변경: `api_key_preview` (varchar(8), nullable) 추가
- 기존 볼트의 `api_key_preview`는 null 허용 (이미 생성된 키의 미리보기는 복구 불가)

---

### Phase 2: 서버 Admin API 라우트

**목표**: 관리자 인증 및 볼트/파일 관리 API 구현

**의존성**: Phase 1 완료

**추가 패키지**:
- `@fastify/cookie` — 쿠키 파싱
- `@fastify/session` — 세션 관리 (메모리 스토어, 추후 Redis 전환 가능)
- `@fastify/static` — 정적 파일 서빙
- `@fastify/rate-limit` — 로그인 rate limiting

**변경 사항**:

| 파일 | 변경 내용 |
|------|-----------|
| `packages/server/package.json` | 수정 — 의존성 추가 |
| `packages/server/src/plugins/session.ts` | 신규 — cookie + session 플러그인 설정 |
| `packages/server/src/plugins/static.ts` | 신규 — @fastify/static 설정 (packages/web/dist 서빙) |
| `packages/server/src/routes/admin/index.ts` | 신규 — admin 라우트 prefix 등록 |
| `packages/server/src/routes/admin/setup.route.ts` | 신규 — POST /admin/api/setup |
| `packages/server/src/routes/admin/auth.route.ts` | 신규 — POST /admin/api/login, POST /admin/api/logout, GET /admin/api/me |
| `packages/server/src/routes/admin/vault.route.ts` | 신규 — GET /admin/api/vaults, POST /admin/api/vaults, POST /admin/api/vaults/:id/regenerate-key |
| `packages/server/src/routes/admin/file.route.ts` | 신규 — GET /admin/api/vaults/:id/files |
| `packages/server/src/middlewares/admin-auth.ts` | 신규 — 세션 기반 인증 미들웨어 (preHandler hook) |
| `packages/server/src/services/admin.service.ts` | 신규 — 관리자 CRUD 서비스 |

**API 엔드포인트 설계**:

```
GET    /admin/api/status          → { initialized: boolean }  (인증 불필요)
POST   /admin/api/setup           → { username, password }    (초기 설정, 1회만)
POST   /admin/api/login           → { username, password }    (rate limited)
POST   /admin/api/logout          → (세션 파기)
GET    /admin/api/me              → { username }              (세션 확인)
GET    /admin/api/vaults          → [{ id, name, api_key_preview, created_at }]
POST   /admin/api/vaults          → { name } → { id, name, api_key, api_key_preview }
POST   /admin/api/vaults/:id/regenerate-key → { id, api_key, api_key_preview }
GET    /admin/api/vaults/:id/files → [{ path, size, updated_at }]
```

**인증 흐름**:
1. 클라이언트가 `GET /admin/api/status` 호출 → `initialized: false`면 setup 페이지 표시
2. Setup 완료 또는 login 성공 → 세션 쿠키 발급
3. 이후 모든 `/admin/api/*` 요청은 세션 쿠키로 인증 (`/admin/api/status`, `/admin/api/setup`, `/admin/api/login` 제외)

---

### Phase 3: 프론트엔드 (packages/web)

**목표**: React + Vite + TypeScript SPA 구현

**의존성**: Phase 2 완료 (API 사용)

**주요 패키지**:
- `react` ^19.0.0, `react-dom` ^19.0.0
- `vite` ^6.x
- `@vitejs/plugin-react` 
- `react-router-dom` ^7.x — SPA 라우팅
- `typescript` ^5.x

**디렉터리 구조**:

```
packages/web/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/
│   │   └── client.ts          ← fetch wrapper (credentials: include)
│   ├── pages/
│   │   ├── setup-page.tsx
│   │   ├── login-page.tsx
│   │   ├── vault-list-page.tsx
│   │   └── vault-files-page.tsx
│   ├── components/
│   │   ├── layout.tsx
│   │   ├── api-key-modal.tsx
│   │   └── empty-state.tsx
│   └── hooks/
│       └── use-auth.ts
└── eslint.config.js            ← extends eslint.shared.mjs + React rules
```

**페이지 구성**:
- `/setup` — 초기 설정 (admin_credentials 미존재 시만 접근 가능)
- `/login` — 로그인
- `/vaults` — 볼트 목록 (대시보드)
- `/vaults/:id/files` — 볼트별 파일 목록

---

### Phase 4: 통합 (Integration)

**목표**: 서버-프론트엔드 통합 및 빌드 파이프라인 구성

**의존성**: Phase 2 + Phase 3 완료

**변경 사항**:

| 파일 | 변경 내용 |
|------|-----------|
| `packages/web/package.json` | 수정 — build script 설정 (`vite build`, outDir: `dist`) |
| `packages/server/src/plugins/static.ts` | 수정 — `../web/dist` 경로에서 정적 파일 서빙 |
| `package.json` (루트) | 수정 — `build:web` 스크립트 추가 |

**SPA Fallback 전략**:
- `@fastify/static`의 `setNotFoundHandler` 또는 wildcard route로 `index.html` 반환
- `/v1/*` 및 `/admin/api/*` 경로는 API로 처리, 나머지는 SPA fallback

**빌드 순서**:
1. `pnpm --filter web build` → `packages/web/dist/` 생성
2. 서버 시작 시 `packages/web/dist/`가 존재하면 정적 파일 서빙 활성화

---

## 위험 요소 (Risks)

| 위험 | 영향 | 완화 전략 |
|------|------|-----------|
| 세션 스토어가 메모리 기반이라 서버 재시작 시 세션 소멸 | 낮음 | Phase 1에서는 허용, 추후 Redis/PostgreSQL 스토어로 전환 |
| 기존 vault.service.ts의 createVault 수정 시 API 호환성 깨짐 | 높음 | api_key_preview 저장 로직만 추가, 기존 반환값 변경 없음 |
| @fastify/static wildcard가 기존 /v1 라우트와 충돌 | 중간 | 정적 파일 서빙 우선순위를 API 라우트보다 낮게 설정 |
| Rate limiting 메모리 사용 | 낮음 | @fastify/rate-limit 기본 메모리 스토어 사용, 소규모 배포 전제 |

---

## 마일스톤 (Milestones)

| 마일스톤 | 우선순위 | 완료 기준 |
|----------|----------|-----------|
| M1: DB 스키마 | High | 마이그레이션 성공, 테이블 생성 확인 |
| M2: Admin API | High | 모든 엔드포인트 동작, 인증 흐름 완료 |
| M3: Frontend SPA | High | 모든 페이지 렌더링, API 연동 완료 |
| M4: Integration | High | 서버에서 SPA 서빙, E2E 흐름 동작 |
