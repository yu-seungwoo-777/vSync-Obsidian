## Task Decomposition
SPEC: SPEC-WEB-001

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | DB 스키마: admin_credentials 테이블 + vaults에 api_key_preview 컬럼 추가 | REQ-SETUP-001, REQ-SETUP-002, REQ-VAULT-004 | - | src/db/schemas/admin-credentials.ts (new), src/db/schemas/vaults.ts (modify), src/db/schemas/index.ts (modify), migrations (new) | pending |
| T-002 | 세션 플러그인 설정: @fastify/cookie + @fastify/session | REQ-AUTH-001, REQ-SEC-001 | T-001 | src/plugins/session.ts (new), package.json (modify) | pending |
| T-003 | 인증 미들웨어: 세션 기반 preHandler hook | REQ-AUTH-002 | T-002 | src/middlewares/admin-auth.ts (new) | pending |
| T-004 | Setup 라우트: GET /admin/api/status, POST /admin/api/setup | REQ-SETUP-001, REQ-SETUP-002, REQ-SETUP-003, REQ-SEC-003 | T-003 | src/routes/admin/index.ts (new), src/routes/admin/setup.route.ts (new), src/services/admin.service.ts (new) | pending |
| T-005 | Auth 라우트: POST /login, POST /logout, GET /me + rate limiting | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003, REQ-SEC-002 | T-003 | src/routes/admin/auth.route.ts (new) | pending |
| T-006 | Vault 라우트: GET /vaults, POST /vaults, POST /vaults/:id/regenerate-key | REQ-VAULT-001, REQ-VAULT-002, REQ-VAULT-003, REQ-VAULT-004 | T-003 | src/routes/admin/vault.route.ts (new) | pending |
| T-007 | File 라우트: GET /admin/api/vaults/:id/files | REQ-FILE-001, REQ-FILE-002 | T-003 | src/routes/admin/file.route.ts (new) | pending |
| T-008 | 정적 파일 서빙: @fastify/static + SPA fallback | REQ-SERVE-001, REQ-PERF-002 | T-002 | src/plugins/static.ts (new), src/app.ts (modify) | pending |
| T-009 | 프론트엔드 SPA: React 19 + Vite + TypeScript 전체 구현 | REQ-SETUP-001~003, REQ-AUTH-001, REQ-VAULT-001~004, REQ-FILE-001~002 | T-004~T-008 | packages/web/** (15 new files) | pending |
| T-010 | 통합: 빌드 파이프라인 + app.ts에 모든 플러그인/라우트 등록 + E2E 흐름 검증 | REQ-SERVE-002, REQ-SERVE-003, REQ-PERF-001 | T-008, T-009 | src/app.ts (modify), tests/admin-integration.test.ts (new) | pending |
