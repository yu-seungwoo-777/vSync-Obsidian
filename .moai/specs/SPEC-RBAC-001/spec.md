---
id: SPEC-RBAC-001
title: 볼트 역할 기반 접근 제어 (Vault RBAC)
version: 1.0.0
status: Planned
created: 2026-04-21
updated: 2026-04-21
author: yu
priority: High
issue_number: null
---

## HISTORY

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| 1.0.0 | 2026-04-21 | 최초 작성 |

---

## 개요 (Overview)

현재 Vector의 관리자 시스템은 모든 인증된 관리자가 모든 볼트에 접근 가능한 단일 롤(admin) 구조다.
본 SPEC은 계정에 역할(role)을 부여하고, 볼트에 생성자(creator)를 추적하여
역할 기반 접근 제어(RBAC)를 구현한다.

---

## 범위 (Scope)

### In-Scope

1. `admin_credentials` 테이블에 `role` 컬럼 추가 (admin / user)
2. `vaults` 테이블에 `created_by` 컬럼 추가 (생성자 admin ID)
3. 볼트 생성 시 생성자 자동 기록
4. 볼트 목록 조회: 볼인 경우 본인 생성 볼트만, 어드민은 전체 조회
5. 볼트 삭제: 어드민 또는 생성자만 가능
6. 키 재생성: 어드민 또는 생성자만 가능
7. 초기 설정(setup) 시 롤 지정 (기본 admin)
8. 웹 프론트엔드에 롤 기반 UI 반영

### Out-of-Scope

- v1 API 인증 변경 (API 키 기반 유지, 롤 영향 없음)
- 다중 사용자 볼트 공유 (추후 SPEC에서 다룸)
- 세분화된 권한 (read-only 관리자 등)
- 계정 관리 UI (사용자 목록, 롤 변경 화면)

---

## 현재 아키텍처 (Current Architecture)

### admin_credentials

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| username | varchar(255) | UNIQUE, NOT NULL |
| passwordHash | varchar(255) | NOT NULL |
| createdAt | timestamptz | NOT NULL |

### vaults

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid | PK |
| name | text | NOT NULL |
| apiKeyHash | text | NOT NULL |
| apiKey | text | 평문 키 |
| apiKeyPreview | text | 마지막 8자리 |
| createdAt | timestamptz | NOT NULL |
| updatedAt | timestamptz | NOT NULL |

### 인증 흐름

- 세션 기반 (`@fastify/session`): `adminId`, `username` 저장
- 미들웨어: `adminId` 유무로만 401 판별, 롤 구분 없음
- v1 API: API 키 기반, 관리자 인증과 무관

---

## 요구사항 (EARS Format)

### REQ-RBAC-001: 계정 역할 부여

**When** 관리자 계정이 생성될 때,
**the system shall** 해당 계정에 `role` 값을 저장한다.

- `role` 값: `"admin"` 또는 `"user"`
- 초기 설정(`POST /admin/api/setup`)으로 생성되는 첫 계정은 `"admin"`
- 이후 생성되는 계정은 명시적으로 롤을 지정하지 않는 한 `"user"`

**Acceptance Criteria:**
- AC-001: `admin_credentials` 테이블에 `role` 컬럼(VARCHAR(20), NOT NULL, DEFAULT 'user')이 존재한다
- AC-002: `POST /admin/api/setup`으로 생성되는 계정의 role은 `"admin"`이다
- AC-003: 기존 admin 계정들은 마이그레이션 시 `role = 'admin'`으로 설정된다

### REQ-RBAC-002: 볼트 생성자 추적

**When** 볼트가 생성될 때,
**the system shall** 생성한 관리자의 ID를 `created_by` 컬럼에 저장한다.

- 관리자 API(`POST /admin/api/vaults`)로 생성 시: 세션의 `adminId` 사용
- v1 API(`POST /v1/vault`)로 생성 시: `created_by`는 NULL (API 키 기반, 관리자 연결 불가)

**Acceptance Criteria:**
- AC-004: `vaults` 테이블에 `created_by` 컬럼(UUID, NULLABLE, FK → admin_credentials.id)이 존재한다
- AC-005: `POST /admin/api/vaults`로 생성된 볼트의 `created_by`는 세션의 관리자 ID이다
- AC-006: `POST /v1/vault`로 생성된 볼트의 `created_by`는 NULL이다

### REQ-RBAC-003: 볼트 목록 접근 제어

**When** 관리자가 볼트 목록을 조회할 때,
**if** 해당 관리자의 role이 `"admin"`이면 **the system shall** 모든 볼트를 반환하고,
**if** role이 `"user"`이면 **the system shall** 해당 관리자가 생성한 볼트만 반환한다.

**Acceptance Criteria:**
- AC-007: role이 `"admin"`인 관리자의 `GET /admin/api/vaults`는 전체 볼트를 반환한다
- AC-008: role이 `"user"`인 관리자의 `GET /admin/api/vaults`는 `created_by`가 본인 ID인 볼트만 반환한다
- AC-009: `created_by`가 NULL인 볼트(v1 API 생성)는 `"user"` 롤 사용자에게 보이지 않는다

### REQ-RBAC-004: 볼트 삭제 권한

**When** 관리자가 볼트를 삭제하려 할 때,
**if** role이 `"admin"`이거나 `created_by`가 본인이면 **the system shall** 삭제를 허용하고,
**otherwise** **the system shall** 403 Forbidden을 반환한다.

**Acceptance Criteria:**
- AC-010: role `"admin"`인 관리자는 모든 볼트를 삭제할 수 있다
- AC-011: role `"user"`인 관리자는 `created_by`가 본인인 볼트만 삭제할 수 있다
- AC-012: 권한이 없는 관리자가 삭제 시도 시 403을 반환한다

### REQ-RBAC-005: 키 재생성 권한

**When** 관리자가 API 키를 재생성하려 할 때,
**if** role이 `"admin"`이거나 `created_by`가 본인이면 **the system shall** 재생성을 허용하고,
**otherwise** **the system shall** 403 Forbidden을 반환한다.

**Acceptance Criteria:**
- AC-013: role `"admin"`인 관리자는 모든 볼트의 키를 재생성할 수 있다
- AC-014: role `"user"`인 관리자는 `created_by`가 본인인 볼트의 키만 재생성할 수 있다
- AC-015: 권한이 없는 관리자가 재생성 시도 시 403을 반환한다

### REQ-RBAC-006: 세션 롤 정보

**When** 관리자가 로그인할 때,
**the system shall** 세션에 `role` 정보를 저장한다.

**Acceptance Criteria:**
- AC-016: 로그인 성공 시 세션에 `role` 필드가 저장된다
- AC-017: `GET /admin/api/me` 응답에 `role` 필드가 포함된다

---

## 기술 접근 (Technical Approach)

### 1. 스키마 변경

**admin_credentials**: `role` 컬럼 추가
```sql
ALTER TABLE admin_credentials ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user';
UPDATE admin_credentials SET role = 'admin'; -- 기존 계정 마이그레이션
```

**vaults**: `created_by` 컬럼 추가
```sql
ALTER TABLE vaults ADD COLUMN created_by UUID REFERENCES admin_credentials(id);
```

### 2. Drizzle 스키마 업데이트

- `admin-credentials.ts`: `role` 필드 추가
- `vaults.ts`: `createdBy` 필드 추가 (FK)
- `drizzle-kit generate` + `drizzle-kit migrate` 사용

### 3. 세션 확장

- `session.ts`: Session 인터페이스에 `role?: string` 추가
- 로그인 시 세션에 `role` 저장

### 4. 인증 미들웨어 변경

- `admin-auth.ts`: 현재 인증만 확인 → 변경 없음 (롤 체크는 각 라우트에서 수행)

### 5. 볼트 라우트 변경

- `GET /vaults`: 세션의 role에 따라 필터링
- `POST /vaults`: `created_by`에 세션 adminId 저장
- `POST /vaults/:id/regenerate-key`: 권한 체크 추가
- `DELETE /vaults/:id`: 권한 체크 추가
- `GET /admin/api/me`: role 포함

### 6. v1 라우트

- `POST /v1/vault`: 변경 없음 (created_by = null)

### 7. 프론트엔드

- `client.ts`: `UserResponse`에 `role` 추가
- `vault-list-page.tsx`: user 롤인 경우 본인 볼트만 표시 (이미 API에서 필터링됨)

---

## 파일 변경 목록

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/db/schemas/admin-credentials.ts` | 수정 | role 필드 추가 |
| `src/db/schemas/vaults.ts` | 수정 | createdBy 필드 추가 |
| `src/plugins/session.ts` | 수정 | Session 타입에 role 추가 |
| `src/routes/admin/setup.route.ts` | 수정 | 첫 계정 role='admin' 설정 |
| `src/routes/admin/auth.route.ts` | 수정 | 로그인 시 세션에 role 저장 |
| `src/routes/admin/vault.route.ts` | 수정 | 권한 체크, created_by 저장 |
| `src/routes/v1.ts` | 수정 | 없음 (v1은 created_by=null) |
| `src/services/vault.ts` | 수정 | createVault에 createdBy 파라미터 추가 |
| `src/middlewares/admin-auth.ts` | 수정 | 없음 (각 라우트에서 체크) |
| `web/src/api/client.ts` | 수정 | UserResponse에 role 추가 |
| `web/src/pages/vault-list-page.tsx` | 수정 | user 롤 UI 반영 |

---

## 테스트 계획

| 테스트 | 파일 | 설명 |
|--------|------|------|
| role 컬럼 존재 | auth.test.ts | admin/user 롤 저장 확인 |
| setup 시 admin 롤 | setup.test.ts | 첫 계정 role='admin' |
| 볼트 created_by | vault.test.ts | 관리자 생성 시 created_by 기록 |
| user 롤 목록 필터 | vault.test.ts | 본인 볼트만 조회 |
| 삭제 권한 | vault.test.ts | admin/user 권한 403 |
| 재생성 권한 | vault.test.ts | admin/user 권한 403 |
| 세션 role | session.test.ts | 로그인 시 role 세션 저장 |

---

## 위험 및 완화

| 위험 | 영향 | 완화 |
|------|------|------|
| 기존 vault의 created_by=NULL | user 롤 사용자가 기존 볼트 안 보임 | 의도된 동작. admin 롤로만 관리 |
| v1 API로 생성된 볼트 | created_by=NULL | admin 롤만 관리 가능 |
| 롤 없는 기존 계정 | 마이그레이션 필요 | ALTER TABLE + UPDATE로 일괄 admin 설정 |
