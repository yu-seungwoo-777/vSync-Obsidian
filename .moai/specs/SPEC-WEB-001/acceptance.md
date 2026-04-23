---
spec_id: SPEC-WEB-001
title: Vector 웹 관리 인터페이스 인수 기준
version: 1.0.0
---

## 인수 기준 (Acceptance Criteria)

---

### AC-SETUP-001: 최초 접근 시 설정 페이지 표시

**Given** `admin_credentials` 테이블에 레코드가 없고
**When** 사용자가 웹 인터페이스 루트(`/`)에 접근하면
**Then** 초기 설정 페이지(`/setup`)로 리다이렉트되어 username, password 입력 폼이 표시된다

---

### AC-SETUP-002: 초기 설정 완료

**Given** 초기 설정 페이지가 표시되어 있고
**When** 관리자가 유효한 username(3자 이상)과 password(8자 이상)를 입력하여 제출하면
**Then**
- `admin_credentials` 테이블에 레코드가 생성된다
- password는 bcrypt(cost 12)로 해싱되어 저장된다
- 세션 쿠키가 발급된다
- 대시보드(`/vaults`)로 리다이렉트된다

---

### AC-SETUP-003: 설정 완료 후 설정 페이지 차단

**Given** `admin_credentials` 테이블에 레코드가 존재하고
**When** 누군가 `/setup` 또는 `POST /admin/api/setup`에 접근하면
**Then** HTTP 403 Forbidden 또는 로그인 페이지로 리다이렉트된다

---

### AC-AUTH-001: 올바른 인증 정보로 로그인

**Given** 관리자 계정이 설정되어 있고
**When** 올바른 username과 password로 `POST /admin/api/login`을 호출하면
**Then**
- HTTP 200 응답과 함께 세션 쿠키가 발급된다
- 쿠키에 `httpOnly`, `sameSite=strict` 속성이 설정된다
- `GET /admin/api/me` 호출 시 username이 반환된다

---

### AC-AUTH-002: 잘못된 인증 정보로 로그인 실패

**Given** 관리자 계정이 설정되어 있고
**When** 잘못된 password로 `POST /admin/api/login`을 호출하면
**Then** HTTP 401 Unauthorized가 반환되고 세션 쿠키가 발급되지 않는다

---

### AC-AUTH-003: 미인증 상태에서 보호된 API 접근

**Given** 유효한 세션 쿠키가 없고
**When** `GET /admin/api/vaults`에 접근하면
**Then** HTTP 401 Unauthorized가 반환된다

---

### AC-AUTH-004: 로그아웃

**Given** 유효한 세션으로 로그인된 상태에서
**When** `POST /admin/api/logout`을 호출하면
**Then**
- 서버측 세션이 파기된다
- 이후 동일 세션 쿠키로 `GET /admin/api/me` 호출 시 401이 반환된다

---

### AC-AUTH-005: 로그인 Rate Limiting

**Given** 동일 IP에서
**When** 5분 이내에 5회 로그인 실패가 발생하면
**Then**
- 6번째 시도부터 HTTP 429 Too Many Requests가 반환된다
- 15분 후 다시 로그인 시도가 가능해진다

---

### AC-VAULT-001: 볼트 생성

**Given** 관리자로 로그인한 상태에서
**When** `POST /admin/api/vaults`에 `{ "name": "my-vault" }`를 전송하면
**Then**
- 새 볼트가 DB에 생성된다
- 응답에 `id`, `name`, `api_key`(원본), `api_key_preview`(마지막 8자)가 포함된다
- `vaults` 테이블의 `api_key_hash`에 bcrypt 해시가 저장된다
- `vaults` 테이블의 `api_key_preview`에 마지막 8자가 저장된다

---

### AC-VAULT-002: 볼트 목록 조회

**Given** 관리자로 로그인한 상태이고 볼트가 3개 존재할 때
**When** `GET /admin/api/vaults`를 호출하면
**Then**
- 3개의 볼트 정보 배열이 반환된다
- 각 볼트에 `id`, `name`, `api_key_preview`, `created_at`이 포함된다
- `api_key`(원본) 또는 `api_key_hash`는 포함되지 않는다

---

### AC-VAULT-003: API 키 재생성

**Given** 관리자로 로그인하고 vault_id가 `abc123`인 볼트가 존재할 때
**When** `POST /admin/api/vaults/abc123/regenerate-key`를 호출하면
**Then**
- 새로운 API 키가 생성된다
- 응답에 `api_key`(새 원본 키)와 `api_key_preview`(새 키의 마지막 8자)가 포함된다
- DB의 `api_key_hash`가 새 키의 해시로 갱신된다
- DB의 `api_key_preview`가 새 키의 마지막 8자로 갱신된다
- 기존 API 키로의 인증은 실패한다

---

### AC-VAULT-004: 볼트 생성 시 프론트엔드 API 키 모달

**Given** 관리자가 볼트 목록 페이지에서 볼트 생성 폼을 작성하고
**When** 생성 버튼을 클릭하면
**Then**
- API 키가 포함된 모달이 표시된다
- "복사" 버튼 클릭 시 API 키가 클립보드에 복사된다
- 모달에 "이 키는 다시 표시되지 않습니다" 경고가 표시된다

---

### AC-FILE-001: 볼트 파일 목록 조회

**Given** 관리자로 로그인하고 vault_id `abc123`에 파일 5개가 존재할 때
**When** `GET /admin/api/vaults/abc123/files`를 호출하면
**Then**
- 5개의 파일 정보 배열이 반환된다
- 각 파일에 `path`, `size`(바이트), `updated_at`이 포함된다

---

### AC-FILE-002: 빈 볼트의 파일 목록

**Given** 관리자로 로그인하고 vault_id `empty-vault`에 파일이 없을 때
**When** `GET /admin/api/vaults/empty-vault/files`를 호출하면
**Then** 빈 배열 `[]`이 반환된다

---

### AC-FILE-003: 프론트엔드 빈 상태 표시

**Given** 관리자가 파일이 없는 볼트의 파일 목록 페이지에 접근했을 때
**When** 페이지가 렌더링되면
**Then** "파일이 없습니다" 빈 상태 메시지가 표시된다

---

### AC-SERVE-001: SPA 정적 파일 서빙

**Given** `packages/web/dist/` 디렉터리에 빌드된 파일이 존재하고
**When** 브라우저가 `/`에 접근하면
**Then** `index.html`이 반환된다

---

### AC-SERVE-002: SPA 라우팅 fallback

**Given** 서버가 실행 중이고
**When** 브라우저가 `/vaults/abc123/files`(존재하지 않는 정적 파일 경로)에 접근하면
**Then** `index.html`이 반환되어 클라이언트 사이드 라우팅이 동작한다

---

### AC-SERVE-003: API 라우트 우선순위

**Given** 서버가 실행 중이고
**When** `GET /v1/vault`를 호출하면
**Then** 기존 API 라우트가 정상 응답하고, SPA fallback이 적용되지 않는다

---

## 엣지 케이스 (Edge Cases)

| 시나리오 | 기대 동작 |
|----------|-----------|
| Setup 중 동시에 두 요청이 들어옴 | 첫 번째만 성공, 두 번째는 403 반환 |
| 매우 긴 username (256자 초과) | 서버에서 유효성 검증 실패, 400 반환 |
| 볼트 이름 중복 | DB unique constraint에 의한 409 Conflict 반환 |
| 존재하지 않는 vault_id로 파일 목록 요청 | 404 Not Found 반환 |
| 세션 만료 후 API 호출 | 401 반환, 프론트엔드에서 로그인 페이지로 리다이렉트 |
| `packages/web/dist/` 미존재 시 서버 시작 | 서버 정상 시작, 정적 파일 서빙만 비활성화 |

---

## 품질 게이트 (Quality Gate Criteria)

- [ ] 모든 API 엔드포인트에 대한 통합 테스트 존재
- [ ] 인증 우회 시나리오 테스트 통과 (미인증 접근 차단 확인)
- [ ] Rate limiting 동작 확인 테스트
- [ ] ESLint 경고 0개 (서버 + 웹 모두)
- [ ] TypeScript 타입 에러 0개
- [ ] 프론트엔드 빌드 성공
- [ ] SPA fallback 동작 확인

---

## Definition of Done

1. `admin_credentials` 테이블 마이그레이션 적용 완료
2. `vaults.api_key_preview` 컬럼 마이그레이션 적용 완료
3. 모든 Admin API 엔드포인트 구현 및 테스트 통과
4. 프론트엔드 SPA 모든 페이지 구현
5. 서버에서 정적 파일 서빙 동작
6. 기존 `/v1/...` API에 영향 없음 확인
7. ESLint + TypeScript 빌드 에러 없음
8. 인증/인가 보안 테스트 통과
