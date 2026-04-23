## Task Decomposition
SPEC: SPEC-RBAC-001

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | admin_credentials 스키마에 role 컬럼 추가 | REQ-RBAC-001 (AC-001) | - | packages/server/src/db/schemas/admin-credentials.ts | pending |
| T-002 | vaults 스키마에 createdBy 컬럼 추가 | REQ-RBAC-002 (AC-004) | T-001 | packages/server/src/db/schemas/vaults.ts | pending |
| T-003 | 데이터베이스 마이그레이션 | REQ-RBAC-001 (AC-003) | T-001, T-002 | drizzle migration | pending |
| T-004 | 세션 타입에 role 추가 | REQ-RBAC-006 (AC-016) | - | packages/server/src/plugins/session.ts | pending |
| T-005 | Setup 라우트 admin 롤 지정 | REQ-RBAC-001 (AC-002) | T-001, T-004 | packages/server/src/routes/admin/setup.route.ts | pending |
| T-006 | Auth 라우트 role 저장 및 /me 반환 | REQ-RBAC-006 (AC-016, AC-017) | T-001, T-004 | packages/server/src/routes/admin/auth.route.ts | pending |
| T-007 | Vault 서비스 createdBy 파라미터 | REQ-RBAC-002 (AC-005, AC-006) | T-002 | packages/server/src/services/vault.ts | pending |
| T-008 | Vault 라우트 RBAC 적용 | REQ-RBAC-003/004/005 | T-002, T-004, T-007 | packages/server/src/routes/admin/vault.route.ts | pending |
| T-009 | 프론트엔드 role 타입 및 UI | REQ-RBAC-006 (AC-017) | T-008 | packages/web/src/api/client.ts, packages/web/src/pages/vault-list-page.tsx | pending |
| T-010 | 통합 테스트 RBAC 흐름 | ALL REQ | T-001~T-008 | packages/server/tests/admin-rbac.test.ts | pending |

### Existing Test Updates (Required)

| File | Change |
|------|--------|
| packages/server/tests/admin-vault.test.ts | db.insert에 role: 'admin' 추가 |
| packages/server/tests/admin-integration.test.ts | db.insert에 role: 'admin' 추가 |
| packages/server/tests/admin-session.test.ts | db.insert에 role: 'admin' 추가 |
| packages/server/tests/admin-files.test.ts | db.insert에 role: 'admin' 추가 |
