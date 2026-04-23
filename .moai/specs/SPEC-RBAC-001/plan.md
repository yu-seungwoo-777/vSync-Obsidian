# SPEC-RBAC-001 Implementation Plan

## Plan Summary

SPEC-RBAC-001은 Vector 관리자 시스템에 역할 기반 접근 제어(RBAC)를 추가한다. 두 개의 새로운 데이터베이스 컬럼(`role`, `created_by`)과 세션 확장, 권한 헬퍼 함수를 통해 볼트 리소스에 대한 역할별 접근 제어를 구현한다.

**범위**: 6개 요구사항, 17개 수용 기준, 14개 파일 변경, 10개 TDD 태스크

**접근 방식**: 공유 권한 헬퍼 함수(Alternative B) - 각 라우트 핸들러에서 호출하는 `checkVaultPermission()` 헬퍼를 통해 인가 로직을 중앙화한다. Fastify preHandler hook보다 단순하고, 인라인 체크보다 유지보수성이 높다.

---

## Requirements Analysis

### REQ-RBAC-001: 계정 역할 부여 (복잡도: LOW)
- AC-001: admin_credentials.role 컬럼 (VARCHAR(20), NOT NULL, DEFAULT 'user')
- AC-002: POST /setup 첫 계정 role='admin'
- AC-003: 기존 계정 마이그레이션 role='admin'

### REQ-RBAC-002: 볼트 생성자 추적 (복잡도: LOW-MEDIUM)
- AC-004: vaults.created_by 컬럼 (UUID, NULLABLE, FK)
- AC-005: POST /admin/api/vaults created_by = 세션 adminId
- AC-006: POST /v1/vault created_by = NULL

### REQ-RBAC-003: 볼트 목록 접근 제어 (복잡도: MEDIUM)
- AC-007: admin 롤 전체 볼트 조회
- AC-008: user 롤 본인 볼트만 조회
- AC-009: created_by=NULL 볼트는 user 롤에 미표시

### REQ-RBAC-004: 볼트 삭제 권한 (복잡도: MEDIUM)
- AC-010: admin 롤 모든 볼트 삭제 가능
- AC-011: user 롤 본인 볼트만 삭제 가능
- AC-012: 권한 없는 삭제 시 403

### REQ-RBAC-005: 키 재생성 권한 (복잡도: MEDIUM)
- AC-013: admin 롤 모든 키 재생성 가능
- AC-014: user 롤 본인 키만 재생성 가능
- AC-015: 권한 없는 재생성 시 403

### REQ-RBAC-006: 세션 롤 정보 (복잡도: LOW)
- AC-016: 로그인 시 세션에 role 저장
- AC-017: GET /admin/api/me에 role 포함

---

## Architecture Decision: Permission Helper (Alternative B)

### 선택 근거
권한 체크 로직을 공유 헬퍼 함수로 중앙화. DELETE와 regenerate-key 라우트에서 동일한 패턴(볼트 조회 -> 권한 확인 -> 작업 수행)을 재사용한다.

### 패턴
```
// 헬퍼 함수 (vault.route.ts 내부 또는 별도 파일)
function checkVaultAccess(role: string, adminId: string, vaultCreatedBy: string | null): boolean {
  if (role === 'admin') return true;
  return vaultCreatedBy === adminId;
}
```

### 거부한 대안
- Alternative A (인라인): 중복 코드, 유지보수 어려움
- Alternative C (Fastify preHandler): 2개 롤에 과도한 추상화

### 트레이드오프 매트릭스

| 기준 (가중치) | A: 인라인 | B: 헬퍼 (선택) | C: preHandler |
|---|---|---|---|
| 성능 (20%) | 10 | 10 | 9 |
| 유지보수성 (25%) | 6 | 9 | 8 |
| 구현 비용 (20%) | 9 | 8 | 5 |
| 리스크 (15%) | 7 | 8 | 6 |
| 확장성 (10%) | 3 | 7 | 9 |
| 테스트 용이성 (10%) | 6 | 9 | 7 |
| **가중 합계** | **7.0** | **8.6** | **7.1** |

---

## Implementation Phases

### Phase 1: Schema & Foundation
스키마 변경, 마이그레이션, 세션 타입 확장. 모든 후속 작업의 기반이 된다.

### Phase 2: Authentication
인증 라우트 수정 - setup 롤 지정, 로그인 롤 저장, /me 롤 반환.

### Phase 3: Authorization
볼트 서비스 및 라우트 RBAC 적용. 권한 헬퍼 구현, GET/DELETE/regenerate 롤 기반 필터링.

### Phase 4: Frontend & Integration
프론트엔드 타입 확장, 전체 RBAC 흐름 통합 테스트.

---

## Task List

### T-001: admin_credentials 스키마에 role 컬럼 추가

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-001 (AC-001) |
| **의존성** | 없음 |
| **파일** | `packages/server/src/db/schemas/admin-credentials.ts` |
| **변경** | `role: varchar("role", { length: 20 }).notNull().default("user")` 추가 |
| **TDD RED** | admin_credentials 스키마에서 role 필드가 정의되어 있는지 확인하는 테스트 작성 |
| **TDD GREEN** | role 컬럼 추가 |
| **검증** | `vitest run` 통과 |

### T-002: vaults 스키마에 createdBy 컬럼 추가

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-002 (AC-004) |
| **의존성** | T-001 (FK 참조) |
| **파일** | `packages/server/src/db/schemas/vaults.ts` |
| **변경** | `createdBy: uuid("created_by").references(() => adminCredentials.id)` 추가 |
| **TDD RED** | vaults 스키마에서 createdBy 필드가 정의되어 있는지 확인하는 테스트 작성 |
| **TDD GREEN** | createdBy 컬럼 추가 (admin_credentials import 필요) |
| **검증** | `vitest run` 통과 |

### T-003: 데이터베이스 마이그레이션

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-001 (AC-003) |
| **의존성** | T-001, T-002 |
| **파일** | Drizzle 마이그레이션 (drizzle-kit push 또는 generate) |
| **변경** | admin_credentials: ADD COLUMN role + UPDATE SET role='admin'; vaults: ADD COLUMN created_by |
| **TDD RED** | 마이그레이션 후 기존 계정의 role='admin' 확인 테스트 |
| **TDD GREEN** | drizzle-kit push 실행 |
| **검증** | 기존 테스트 전체 통과 + 스키마 반영 확인 |

### T-004: 세션 타입에 role 추가

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-006 (AC-0016 일부) |
| **의존성** | 없음 |
| **파일** | `packages/server/src/plugins/session.ts` |
| **변경** | Session 인터페이스에 `role?: string` 추가 |
| **TDD RED** | 세션에 role을 set/get 할 수 있는지 확인하는 타입/컴파일 테스트 |
| **TDD GREEN** | role 필드 추가 |
| **검증** | TypeScript 컴파일 통과 |

### T-005: Setup 라우트 - 첫 계정 admin 롤 지정

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-001 (AC-002), REQ-RBAC-006 (AC-016 일부) |
| **의존성** | T-001, T-004 |
| **파일** | `packages/server/src/routes/admin/setup.route.ts`, `packages/server/src/services/admin.service.ts` |
| **변경** | createAdmin에 role 파라미터 추가 (옵셔널, 기본 'user'), setup에서 role='admin' 전달, 세션에 role 저장 |
| **TDD RED** | POST /setup 후 DB에서 role='admin' 확인 테스트 + 세션 role 확인 테스트 |
| **TDD GREEN** | 서비스 + 라우트 수정 |
| **검증** | `vitest run` 통과 |

### T-006: Auth 라우트 - 로그인 시 role 저장, /me에 role 반환

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-006 (AC-016, AC-017) |
| **의존성** | T-001, T-004 |
| **파일** | `packages/server/src/routes/admin/auth.route.ts`, `packages/server/src/services/admin.service.ts` |
| **변경** | getAdminByUsername이 role 반환, 로그인 시 `session.set("role", admin.role)`, /me에서 role 필드 반환 |
| **TDD RED** | (1) POST /login 후 세션에 role 저장 확인, (2) GET /me 응답에 role 필드 포함 확인 |
| **TDD GREEN** | auth.route.ts 수정 |
| **검증** | `vitest run` 통과 |

### T-007: Vault 서비스 - createdBy 파라미터

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-002 (AC-005, AC-006) |
| **의존성** | T-002 |
| **파일** | `packages/server/src/services/vault.ts` |
| **변경** | `createVault(db, name, createdBy?)` - 선택적 파라미터, 제공 시 values에 포함 |
| **TDD RED** | (1) createVault(db, name, adminId) 호출 시 createdBy 기록 확인, (2) createVault(db, name) 호출 시 createdBy 미설정 확인 |
| **TDD GREEN** | createVault 시그니처 수정 |
| **검증** | `vitest run` 통과 + v1 라우트 회귀 테스트 통과 |

### T-008: Vault 라우트 - RBAC 적용

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-002 (AC-005), REQ-RBAC-003 (AC-007~009), REQ-RBAC-004 (AC-010~012), REQ-RBAC-005 (AC-013~015) |
| **의존성** | T-002, T-004, T-007 |
| **파일** | `packages/server/src/routes/admin/vault.route.ts` |
| **변경** | 권한 헬퍼 함수 추가, GET/POST/DELETE/regenerate 핸들러 수정 |
| **TDD RED (서브태스크)** | |
| T-008a | POST /vaults created_by에 세션 adminId 저장 확인 |
| T-008b | GET /vaults admin 롤 전체 반환 확인 |
| T-008c | GET /vaults user 롤 본인 볼트만 반환 확인 |
| T-008d | GET /vaults user 롤에 created_by=NULL 미표시 확인 |
| T-008e | DELETE admin 롤 성공 확인 |
| T-008f | DELETE user 롤 본인 볼트 성공 확인 |
| T-008g | DELETE user 롤 타인 볼트 403 확인 |
| T-008h | Regenerate admin 롤 성공 확인 |
| T-008i | Regenerate user 롤 본인 볼트 성공 확인 |
| T-008j | Regenerate user 롤 타인 볼트 403 확인 |
| **TDD GREEN** | 권한 헬퍼 + 각 핸들러 수정 |
| **검증** | `vitest run` 통과 |

### T-009: 프론트엔드 - role 타입 및 UI 반영

| 항목 | 내용 |
|------|------|
| **REQ** | REQ-RBAC-006 (AC-017 프론트엔드) |
| **의존성** | T-008 |
| **파일** | `packages/web/src/api/client.ts`, `packages/web/src/pages/vault-list-page.tsx` |
| **변경** | UserResponse에 role 필드 추가, 롤에 따른 UI 조건부 렌더링 (필요 시) |
| **TDD RED** | UserResponse 타입에 role 포함 확인 |
| **TDD GREEN** | 타입 + UI 수정 |
| **검증** | TypeScript 컴파일 + 수동 UI 확인 |

### T-010: 통합 테스트 - 전체 RBAC 흐름

| 항목 | 내용 |
|------|------|
| **REQ** | 모든 REQ 교차 검증 |
| **의존성** | T-001 ~ T-008 |
| **파일** | `packages/server/tests/admin-rbac.test.ts` (신규) |
| **변경** | 전체 RBAC 흐름 테스트: setup(admin) -> create vault -> create user -> user login -> visibility check -> permission check |
| **TDD RED** | 통합 테스트 케이스 작성 |
| **TDD GREEN** | 이미 T-001~T-008에서 구현 완료, 테스트만 통과 확인 |
| **검증** | `vitest run` 전체 통과 |

---

## Existing Test Updates Required

다음 기존 테스트 파일들은 관리자 계정을 직접 DB INSERT로 생성하므로, 스키마 변경 후 DEFAULT 'user'가 적용된다. RBAC 권한 체크가 추가되면 기존 테스트가 실패할 수 있으므로 `role: 'admin'`을 명시적으로 추가해야 한다.

| 파일 | 변경 |
|------|------|
| `packages/server/tests/admin-vault.test.ts` | beforeAll의 db.insert에 `role: 'admin'` 추가 |
| `packages/server/tests/admin-integration.test.ts` | db.insert에 `role: 'admin'` 추가 |
| `packages/server/tests/admin-session.test.ts` | db.insert에 `role: 'admin'` 추가 |
| `packages/server/tests/admin-files.test.ts` | db.insert에 `role: 'admin'` 추가 |

---

## Risk Assessment

| 위험 | 영향 | 가능성 | 완화 전략 |
|------|------|--------|-----------|
| 기존 테스트 실패 (role DEFAULT 'user') | HIGH | HIGH | 모든 테스트의 db.insert에 role='admin' 명시 |
| 마이그레이션 데이터 무결성 | HIGH | LOW | ALTER + UPDATE를 drizzle-kit으로 원자적 처리 |
| 세션 롤 부실함 (staleness) | MEDIUM | 현재 ZERO | MVP 수용, 향후 롤 변경 기능 추가 시 재검토 |
| v1 API 회귀 | HIGH | LOW | createVault 선택적 파라미터로 하위 호환 유지 |
| created_by=NULL 볼트 user 롤에 미표시 | LOW | CERTAIN (의도됨) | SPEC AC-009에 명시된 의도된 동작 |
| 권한 체크 시 2회 DB 조회 | LOW | CERTAIN | 이미 404 체크를 위해 1회 조회 중, 확장만 수행 |

---

## Success Criteria

각 수용 기준의 검증 방법:

| AC | 검증 방법 | 테스트 태스크 |
|----|-----------|--------------|
| AC-001 | admin_credentials 스키마에 role 필드 존재 | T-001 |
| AC-002 | POST /setup 응답 + DB 조회 role='admin' | T-005 |
| AC-003 | 마이그레이션 후 기존 계정 role='admin' | T-003 |
| AC-004 | vaults 스키마에 createdBy 필드 존재 | T-002 |
| AC-005 | POST /admin/api/vaults 후 DB created_by = 세션 adminId | T-008a |
| AC-006 | POST /v1/vault 후 DB created_by = NULL | T-007 |
| AC-007 | admin 롤 GET /vaults 전체 반환 | T-008b |
| AC-008 | user 롤 GET /vaults 본인 볼트만 반환 | T-008c |
| AC-009 | user 롤에 created_by=NULL 미표시 | T-008d |
| AC-010 | admin 롤 DELETE 성공 | T-008e |
| AC-011 | user 롤 본인 볼트 DELETE 성공 | T-008f |
| AC-012 | user 롤 타인 볼트 DELETE 403 | T-008g |
| AC-013 | admin 롤 regenerate 성공 | T-008h |
| AC-014 | user 롤 본인 볼트 regenerate 성공 | T-008i |
| AC-015 | user 롤 타인 볼트 regenerate 403 | T-008j |
| AC-016 | POST /login 후 세션에 role 저장 | T-006 |
| AC-017 | GET /me 응답에 role 필드 포함 | T-006 |

---

## Task Dependency Graph

```
T-001 (admin_credentials.role) ─┐
                                 ├─► T-003 (migration)
T-002 (vaults.createdBy) ───────┘
       │
       │         T-004 (session type) ──┬──► T-005 (setup route)
       │                                └──► T-006 (auth routes)
       │
       └──► T-007 (vault service) ─┐
                                     ├─► T-008 (vault routes RBAC)
       T-004 ──────────────────────┘         │
                                              ├─► T-009 (frontend)
                                              └─► T-010 (integration test)
```

**병렬 가능 태스크**:
- T-001, T-002 (서로 다른 스키마 파일)
- T-004, T-007 (서로 다른 파일, 의존성 없음)
- T-005, T-006 (서로 다른 라우트 파일)

---

## Key Design Decisions for Implementation Agent

1. **createAdmin 서비스**: `createAdmin(db, username, password, role = 'user')` - role 파라미터 추가, 기본값 'user'
2. **getAdminByUsername 서비스**: 반환 타입에 `role` 필드 포함
3. **createVault 서비스**: `createVault(db, name, createdBy?: string)` - 선택적 파라미터
4. **vault.route.ts**: admin 라우트는 자체 inline INSERT 사용 (createVault 서비스 호출 안 함), createdBy를 직접 추가
5. **권한 헬퍼**: vault.route.ts 내부에 private 함수로 구현 (별도 파일 불필요, 사용하는 곳이 한 파일뿐)
6. **세션 role**: login 시 DB에서 읽어 세션에 캐시, 재로그인 시에만 갱신
7. **기존 테스트**: 모든 테스트의 직접 DB INSERT에 `role: 'admin'` 명시 필수
