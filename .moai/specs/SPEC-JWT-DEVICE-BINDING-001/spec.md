---
id: SPEC-JWT-DEVICE-BINDING-001
version: 1.1.0
status: Implemented
created: 2026-04-22
updated: 2026-04-22
author: yu
priority: High
issue_number: null
---

# SPEC-JWT-DEVICE-BINDING-001: JWT + device_id 바인딩 및 만료 제거

## HISTORY

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| 1.0.0 | 2026-04-22 | 초기 SPEC 작성 | yu |

---

## 배경 (Background)

현재 시스템은 JWT 토큰에 `{ user_id, username, role }`을 담고 7일 만료(`expiresIn: "7d"`)를 적용한다. 서버 재시작 시에도 JWT_SECRET이 동일하면 토큰이 유효해야 하지만, 7일 경과 후에는 재로그인이 필요하다. 사용자는 서버 재시작, 플러그인 업데이트, Obsidian 재시작 등의 상황에서 토큰이 지속되기를 원한다.

device_id는 플러그인에서 `crypto.randomUUID()`로 생성되어 `.obsidian/plugins/vsync/data.json`에 저장되며, 이미 모든 API 요청에 `X-Device-ID` 헤더로 전송되고 있다. 이 device_id를 JWT 페이로드에 바인딩하여 토큰 도용 시 다른 기기에서 사용할 수 없도록 보안을 강화하는 동시에, 토큰 만료를 제거하여 사용자 편의성을 개선한다.

---

## 요구사항 (Requirements)

### REQ-DB-001: JWT 페이로드에 device_id 포함 [Ubiquitous]

시스템은 JWT 토큰 생성 시 페이로드에 `device_id` 필드를 **포함하여야 한다**.

- `JwtPayload` 타입에 `device_id: string` 필드가 추가되어야 한다.
- 토큰 생성 시 전달받은 `device_id`가 페이로드에 포함되어야 한다.

### REQ-DB-002: JWT 토큰 만료 제거 [Ubiquitous]

시스템은 JWT 토큰 생성 시 `expiresIn` 옵션을 **설정하지 않아야 한다**.

- `generateToken` 함수에서 `expiresIn` 매개변수가 제거되어야 한다.
- 토큰은 JWT_SECRET이 변경되지 않는 한 영구 유효하여야 한다.

### REQ-DB-003: 로그인 시 device_id 수락 [Event-Driven]

**When** 클라이언트가 `POST /v1/auth/login` 요청을 `device_id` 필드와 함께 전송하면, 시스템은 인증 성공 시 `device_id`를 포함한 JWT 토큰을 **발급하여야 한다**.

- 요청 본문에 `device_id` 필드가 포함되어야 한다.
- `device_id`가 누락된 경우 400 에러를 반환하여야 한다.
- 발급된 토큰의 페이로드에 `device_id`가 포함되어야 한다.

### REQ-DB-004: 인증 미들웨어 device_id 검증 [Event-Driven]

**When** JWT 인증 미들웨어가 요청을 처리할 때, 시스템은 JWT 페이로드의 `device_id`와 요청 헤더 `X-Device-ID`의 일치 여부를 **검증하여야 한다**.

- JWT 페이로드에서 `device_id`를 추출하여야 한다.
- 요청 헤더 `X-Device-ID` 값을 읽어야 한다.
- 두 값이 일치하면 요청을 통과시켜야 한다.
- 두 값이 불일치하면 401 Unauthorized를 반환하여야 한다.
- `X-Device-ID` 헤더가 누락된 경우 401 Unauthorized를 반환하여야 한다.

### REQ-DB-005: 플러그인 로그인 시 device_id 전송 [Event-Driven]

**When** 플러그인이 로그인 요청을 수행할 때, 시스템은 저장된 `device_id`를 로그인 요청 본문에 **포함하여 전송하여야 한다**.

- `login` 함수가 `device_id` 매개변수를 추가로 수락하여야 한다.
- 요청 본문에 `device_id` 필드가 포함되어야 한다.

### REQ-DB-006: device_id 불일치 시 재인증 트리거 [Event-Driven]

**When** 플러그인이 API 요청에서 401 응답을 수신하면, 시스템은 인증 실패 콜백을 **호출하여야 한다**.

- 기존 `_handleError` 메서드의 401 감지 로직이 그대로 작동하여야 한다.
- `_on_auth_failure` 콜백이 호출되어 재로그인 플로우가 시작되어야 한다.

### REQ-DB-007: 토큰 지속 시나리오 보장 [State-Driven]

**While** 다음 조건이 유지되면, 시스템은 기존 JWT 토큰이 계속 유효함을 **보장하여야 한다**.

- 서버 재시작 (JWT_SECRET 동일): 토큰 유효, device_id 불변
- 플러그인 업데이트: data.json 보존, 동일 device_id, 토큰 유효
- Obsidian 재시작: data.json 보존, 동일 device_id, 토큰 유효
- 동일 볼트, 다른 기기: 각각 다른 device_id, 각각 별도 JWT 발급
- OS 업데이트: data.json 보존, 동일 device_id, 토큰 유효
- 네트워크 변경: device_id는 네트워크 무관, 토큰 유효

### REQ-DB-008: 재인증 필요 시나리오 정의 [State-Driven]

**While** 다음 조건 중 하나가 발생하면, 시스템은 재인증을 **요구하여야 한다**.

- 수동 연결 해제: session_token 초기화, 재로그인 필요
- JWT_SECRET 변경: 모든 토큰 무효화, 재로그인 필요
- data.json 삭제 (플러그인 재설치): 새 device_id 생성, 페이로드 불일치, 재로그인 필요
- 다른 볼트: 다른 .obsidian 폴더, 다른 data.json, 다른 device_id, 정상 동작

### REQ-DB-009: 토큰 도용 방지 [Unwanted Behavior]

**If** JWT 토큰이 탈취되어 다른 기기에서 사용되면, 시스템은 요청을 **거부하여야 한다**.

- 다른 기기의 X-Device-ID가 JWT의 device_id와 불일치
- 401 Unauthorized 응답 반환
- 정상 기기의 동일 볼트에서 2개 Obsidian 인스턴스 실행 시: 동일 data.json, 동일 device_id, 정상 승인

---

## 제약사항 (Constraints)

| 항목 | 내용 |
|------|------|
| 새 의존성 | 추가하지 않음 (jsonwebtoken 기존 사용) |
| 기존 인프라 | X-Device-ID 헤더 인프라 그대로 활용 |
| 서버 프레임워크 | Fastify 5 + Drizzle ORM |
| 플러그인 환경 | Obsidian (Electron), requestUrl API 사용 |
| 언어 설정 | 코드 주석: 한국어, 커밋 메시지: 한국어 |

---

## Delta 마커 (Brownfield 변경 대상)

| 마커 | 파일 | 변경 내용 |
|------|------|-----------|
| [MODIFY] | packages/server/src/services/jwt.ts | JwtPayload에 device_id 추가, expiresIn 제거 |
| [MODIFY] | packages/server/src/services/auth.ts | device_id 검증 로직 추가 |
| [MODIFY] | packages/server/src/routes/v1.ts | 로그인 시 device_id 수락, JWT에 포함 |
| [MODIFY] | packages/plugin/src/api-client.ts | 로그인 시 device_id 전송 |

---

## Exclusions (구현하지 않을 사항)

- 토큰 취소(revocation) 메커니즘: JWT_SECRET 변경으로만 전체 무효화 가능
- 리프레시 토큰(refresh token) 플로우
- MAC 주소 기반 기기 바인딩
- 서버 측 세션 스토리지
- WebSocket 인증 변경: 이미 JWT를 사용 중이며 device_id 바인딩이 자동 적용됨
- 관리자 패널 인증 변경: 세션 쿠키 기반이며 JWT가 아님

---

## Implementation Notes

### Implementation Date: 2026-04-22
### Commit: 8983dfa

### Requirements Coverage

| REQ | Description | Status |
|-----|-------------|--------|
| REQ-DB-001 | JwtPayload에 device_id 추가 | Implemented |
| REQ-DB-002 | JWT 토큰 만료 제거 (expiresIn 제거) | Implemented |
| REQ-DB-003 | Login 라우트 device_id 수락 (400 on missing) | Implemented |
| REQ-DB-004 | Auth middleware device_id 검증 (X-Device-ID vs JWT) | Implemented |
| REQ-DB-005 | Plugin login 함수 device_id 전송 | Implemented |
| REQ-DB-006 | 401 시 재인증 트리거 (기존 로직 유지) | Verified |
| REQ-DB-007 | 토큰 지속 시나리오 (재시작, 업데이트 등) | Verified |
| REQ-DB-008 | 재인증 필요 시나리오 (연결해제, SECRET 변경 등) | Verified |
| REQ-DB-009 | 토큰 도용 방지 (device_id 불일치 시 401) | Implemented |

### Files Modified

**Server (packages/server/):**
- `src/services/jwt.ts` — JwtPayload에 device_id 추가, TOKEN_EXPIRY 제거
- `src/services/auth.ts` — device_id 검증 로직 추가
- `src/routes/v1.ts` — login handler에 device_id 필수 검증 추가
- `tests/helpers/jwt-auth.ts` — 테스트 헬퍼에 device_id/X-Device-ID 추가
- `tests/auth.test.ts` — device_id 검증 테스트 4개 추가
- `tests/jwt.test.ts` (new) — JWT 코어 테스트 7개
- `tests/login-device-binding.test.ts` (new) — login route 테스트 4개
- `tests/admin-files.test.ts`, `tests/admin-integration.test.ts`, `tests/websocket.test.ts` — device_id 대응
- `tests/sync-api.test.ts`, `tests/sync-event-integration.test.ts` — device_id 정합성

**Plugin (packages/plugin/):**
- `src/api-client.ts` — login()에 deviceId 파라미터 추가
- `src/ui/connect-modal.ts` — login 호출부에 device_id 전달
- `tests/unit/api-client.test.ts` — login device_id 테스트 추가

### Divergence from Plan

- SPEC에 누락되었던 `connect-modal.ts`가 구현 중 발견되어 포함됨
- 구현은 계획과 정확히 일치 (편차 없음)

### Quality Metrics

- Tests: 472/472 passed (53 files)
- New Tests: 16
- TypeScript: PASS (tsc --noEmit)
- ESLint: PASS
