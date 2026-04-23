# SPEC-JWT-DEVICE-BINDING-001 실행 전략

## 1. 개요

JWT 토큰에 device_id를 바인딩하고 만료를 제거하는 Brownfield 변경. 서버 3개 파일, 플러그인 2개 파일(1개는 SPEC에 누락됨), 테스트 인프라 1개 파일을 수정한다.

### 복잡도 점수: 5/10

| 요인 | 점수 | 근거 |
|------|------|------|
| 변경 파일 수 | 3 | 5개 소스 + 1개 테스트 헬퍼 |
| 개념적 복잡도 | 2 | 필드 추가 + 값 비교, 매우 단순 |
| 테스트 영향 범위 | 7 | ~19개 테스트 파일 간접 영향 |
| 의존성 위험 | 2 | 새 의존성 없음, DB 스키마 변경 없음 |
| 보안 영향 | 6 | 토큰 무만료 + device_id 바인딩 보안 모델 |

---

## 2. Phase 0: 가정 감사 (Assumption Audit)

### 검증된 가정

| # | 가정 | 신뢰도 | 검증 방법 |
|---|------|--------|-----------|
| 1 | device_id가 플러그인에 이미 존재함 | HIGH | VSyncSettings.device_id 확인, main.ts에서 crypto.randomUUID()로 생성 |
| 2 | X-Device-ID 헤더가 이미 모든 API 요청에 포함됨 | HIGH | `_getAuthAndDeviceHeaders()` 확인, 이미 X-Device-ID 전송 중 |
| 3 | login()은 클래스 외부의 정적 함수임 | HIGH | api-client.ts line 194 확인 |
| 4 | auth.ts 미들웨어는 현재 device_id를 검증하지 않음 | HIGH | auth.ts 전체 검토, JWT 검증 + vault 접근만 확인 |
| 5 | 관리자 패널은 세션 쿠키 기반이며 JWT가 아님 | HIGH | SPEC Exclusions에 명시 |

### SPEC에 누락된 항목 (발견)

| 항목 | 파일 | 이유 |
|------|------|------|
| **connect-modal.ts** | `packages/plugin/src/ui/connect-modal.ts` | `login()` 호출부 (line 223) — 시그니처 변경 시 반드시 수정 필요 |
| **main.ts login 호출부** | `packages/plugin/src/main.ts` | `_connectToServer` 등에서 login() 간접 호출 가능성 |

---

## 3. Phase 0.5: First Principles 분해

### 근원 원인 분석 (Five Whys)

1. **표면**: device_id를 JWT에 바인딩하고 만료를 제거한다
2. **직접 원인**: 토큰 도용 방지 + 서버 재시작 후에도 세션 유지
3. **근본 원인**: 기존 JWT가 단기 세션 토큰으로 설계됨 — 사용자는 영구 인증을 기대
4. **시스템 원인**: 인증 모델이 "stateless JWT + 만료"에서 "persistent identity-bound token"으로 진화 필요

### 제약 vs 자유도

**하드 제약 (Hard Constraints)**:
- 새 의존성 추가 불가
- 기존 X-Device-ID 인프라 활용
- TDD 모드 (RED-GREEN-REFACTOR)
- 코드 주석: 한국어, 커밋 메시지: 한국어

**자유도 (Degrees of Freedom)**:
- 에러 메시지 영문/국문 선택
- 미들웨어 내 device_id 검증 위치 (vault 체크 전/후)
- login() 시그니처 변경 방식 (매개변수 추가 vs 객체 매개변수)

---

## 4. Phase 0.75: 대안 생성 및 선택

### 대안 비교

| 대안 | 접근 | 장점 | 단점 | 점수 |
|------|------|------|------|------|
| A: 직접 수정 | SPEC 그대로 파일별 수정 | 단순 | ~19개 테스트 파일 개별 수정 | 6.05 |
| **B: 헬퍼 기반** (선택) | 중앙 테스트 헬퍼 활용 | 수정 범위 최소화 | 초기 헬퍼 수정 필요 | **8.05** |
| C: Fastify 훅 | preValidation 훅 사용 | 관심사 분리 | 복잡도 증가, 파일 추가 | 6.25 |

### 선택 근거: 대안 B (헬퍼 기반)

`jwt-auth.ts` 헬퍼가 ~15개 테스트 파일에서 이미 사용 중이므로, 이 헬퍼에 device_id를 추가하면 대부분의 테스트가 자동으로 수정됨. 직접 login을 호출하는 ~4개 파일만 개별 수정 필요.

---

## 5. 파일 영향 분석

### 서버 (packages/server)

#### jwt.ts (32 lines)
| 함수/영역 | 변경 유형 | 상세 |
|-----------|-----------|------|
| `JwtPayload` interface | MODIFY | `device_id: string` 필드 추가 |
| `TOKEN_EXPIRY` 상수 | DELETE | `"7d"` 상수 제거 |
| `generateToken()` | MODIFY | `expiresIn` 옵션 제거 |
| `verifyToken()` | NO CHANGE | 만료 없는 토큰도 정상 검증 |

#### auth.ts (110 lines)
| 함수/영역 | 변경 유형 | 상세 |
|-----------|-----------|------|
| `createAuthMiddleware()` | MODIFY | JWT 검증 후 `request.user = payload` 이후, vaultId 체크 전에 device_id 검증 삽입 |
| 검증 로직 (신규) | ADD | `payload.device_id !== xDeviceId` → 401 "Device identity mismatch" |
| 헤더 누락 (신규) | ADD | `!xDeviceId` → 401 "Missing device identity" |

**삽입 위치**: line 37 (`request.user = payload;`) 이후, line 39 (`const vaultId = ...`) 이전

#### v1.ts (930 lines)
| 함수/영역 | 변경 유형 | 상세 |
|-----------|-----------|------|
| `POST /auth/login` 핸들러 (line 101) | MODIFY | `{ username, password }` → `{ username, password, device_id }` 구조분해 |
| device_id 검증 (신규) | ADD | `!device_id` → 400 에러 |
| `generateToken` 호출 (line 137) | MODIFY | payload에 `device_id` 추가 |

### 플러그인 (packages/plugin)

#### api-client.ts (748 lines)
| 함수/영역 | 변경 유형 | 상세 |
|-----------|-----------|------|
| `login()` (line 194) | MODIFY | 4번째 매개변수 `deviceId: string` 추가 |
| `login()` body (line 204) | MODIFY | `{ username, password }` → `{ username, password, device_id: deviceId }` |

#### connect-modal.ts (320 lines) — SPEC 누락, 필수 수정
| 함수/영역 | 변경 유형 | 상세 |
|-----------|-----------|------|
| `_handleLogin()` (line 223) | MODIFY | `login(serverUrl, username, password)` → `login(serverUrl, username, password, this._settings.device_id)` |

### 테스트 인프라

#### jwt-auth.ts (77 lines) — 중앙 헬퍼
| 함수/영역 | 변경 유형 | 상세 |
|-----------|-----------|------|
| `setupTestAuth()` (line 23) | MODIFY | login payload에 `device_id: "test-device-id"` 추가 |
| `authHeaders()` (line 54) | MODIFY | `X-Device-ID: "test-device-id"` 헤더 추가 |

#### 직접 login 호출 테스트 파일 (~4개)
| 파일 | 변경 내용 |
|------|-----------|
| `auth.test.ts` | login payload에 device_id 추가, API 요청에 X-Device-ID 헤더 추가 |
| `admin-files.test.ts` | login payload에 device_id 추가, API 요청에 X-Device-ID 헤더 추가 |
| `admin-integration.test.ts` | login payload에 device_id 추가 (2곳) |
| `websocket.test.ts` | login payload에 device_id 추가, WS 연결에 X-Device-ID 헤더 추가 |

---

## 6. TDD 태스크 분해 (RED-GREEN-REFACTOR)

### Cycle 1: JWT Core — jwt.ts
**REQ 매핑**: REQ-DB-001, REQ-DB-002
**의존성**: 없음 (첫 번째 사이클)

| 단계 | 내용 |
|------|------|
| **RED** | `generateToken`에 device_id가 포함된 페이로드를 전달하면 JWT에 device_id가 포함되는지 확인하는 테스트 작성. 디코딩 시 `exp` 클레임이 없는지 확인. |
| **GREEN** | `JwtPayload`에 `device_id: string` 추가. `TOKEN_EXPIRY` 상수 삭제. `jwt.sign()`에서 `expiresIn` 옵션 제거. |
| **REFACTOR** | 주석 정리 (한국어). @MX 태그 업데이트. |

### Cycle 2: Auth Middleware — auth.ts
**REQ 매핑**: REQ-DB-004, REQ-DB-009
**의존성**: Cycle 1 완료 후

| 단계 | 내용 |
|------|------|
| **RED** | 3개 테스트 작성: (1) device_id 일치 시 통과, (2) 불일치 시 401, (3) X-Device-ID 누락 시 401 |
| **GREEN** | `createAuthMiddleware`에 device_id 검증 로직 추가. JWT payload.device_id와 X-Device-ID 헤더 비교. |
| **REFACTOR** | 검증 로직 명확한 한국어 주석. 에러 메시지 "Device identity mismatch" / "Missing device identity" 통일. |

### Cycle 3: Login Route — v1.ts
**REQ 매핑**: REQ-DB-003
**의존성**: Cycle 1 완료 후

| 단계 | 내용 |
|------|------|
| **RED** | 2개 테스트 작성: (1) device_id 포함 로그인 시 JWT에 device_id 포함 확인, (2) device_id 누락 시 400 확인 |
| **GREEN** | 구조분해에 `device_id` 추가. 누락 검증. `generateToken` 호출 시 device_id 포함. |
| **REFACTOR** | N/A (작은 변경) |

### Cycle 4: Plugin Login + Connect Modal — api-client.ts, connect-modal.ts
**REQ 매핑**: REQ-DB-005
**의존성**: Cycle 3 완료 후 (서버가 device_id를 받아들이면 플러그인 수정)

| 단계 | 내용 |
|------|------|
| **RED** | `login()` 함수에 deviceId 매개변수가 있고 요청 본문에 device_id가 포함되는지 확인하는 테스트 작성 |
| **GREEN** | `login()` 시그니처에 `deviceId: string` 추가. body에 `device_id` 포함. connect-modal.ts 호출부 업데이트. |
| **REFACTOR** | N/A |

### Cycle 5: Test Infrastructure Update — jwt-auth.ts + ~4개 직접 호출 테스트
**REQ 매핑**: REQ-DB-006 (회귀 방지)
**의존성**: Cycle 1-4 모두 완료 후

| 단계 | 내용 |
|------|------|
| **RED** | 기존 테스트 스위트 실행 — device_id 누락으로 인한 실패 확인 |
| **GREEN** | jwt-auth.ts: login payload에 device_id 추가, authHeaders에 X-Device-ID 추가. 직접 호출 4개 파일 개별 수정. |
| **REFACTOR** | 테스트 device_id를 상수로 추출 (`TEST_DEVICE_ID = "test-device-id"`). 전체 테스트 스위트 회귀 확인. |

---

## 7. 위험 평가

### 높은 위험

| 위험 | 영향 | 완화 전략 |
|------|------|-----------|
| **connect-modal.ts가 SPEC에 누락됨** | login() 시그니처 변경 시 컴파일 에러 발생 | 본 전략에서 명시적으로 포함 |
| **~19개 테스트 파일 영향** | 회귀 위험 | jwt-auth.ts 중앙 헬퍼 활용으로 최소화 |
| **토큰 무만료의 보안 영향** | 장기 유효 토큰 탈취 시永久 노출 | device_id 바인딩으로 완화, JWT_SECRET 변경 시 전체 무효화 |

### 중간 위험

| 위험 | 영향 | 완화 전략 |
|------|------|-----------|
| **구형 토큰 (device_id 없음) 처리** | 기존 세션 즉시 무효화 | 의도된 동작 (SPEC REQ-DB-008), 재로그인 유도 |
| **동일 기기 2개 Obsidian 창** | 동일 data.json, 동일 device_id | 정상 동작 (SPEC REQ-DB-009 명시) |
| **WebSocket 인증** | WS 연결 시 device_id 검증 | 이미 JWT 기반이며 device_id 바인딩 자동 적용 (SPEC Exclusions) |

### 낮은 위험

| 위험 | 영향 | 완화 전략 |
|------|------|-----------|
| **에러 메시지 국제화** | 영문 에러 메시지 | SPEC에서 에러 메시지는 영어로 명시 |

---

## 8. 실행 순서

```
Cycle 1 (jwt.ts)
    ↓
Cycle 2 (auth.ts) ← Cycle 1 의존
    ↓
Cycle 3 (v1.ts) ← Cycle 1 의존, Cycle 2와 병렬 가능
    ↓
Cycle 4 (api-client.ts + connect-modal.ts) ← Cycle 3 서버 완료 후
    ↓
Cycle 5 (테스트 인프라) ← 모든 구현 완료 후
```

**병렬 가능**: Cycle 2와 Cycle 3은 서로 의존하지 않으므로 병렬 실행 가능.

---

## 9. Definition of Done

- [ ] `JwtPayload`에 `device_id: string` 추가
- [ ] `TOKEN_EXPIRY` 상수 및 `expiresIn` 옵션 제거
- [ ] 로그인 라우트가 device_id를 요청 본문에서 수락
- [ ] device_id 누락 시 400 반환
- [ ] 인증 미들웨어가 JWT device_id와 X-Device-ID 비교
- [ ] 불일치 시 401 반환
- [ ] X-Device-ID 누락 시 401 반환
- [ ] 플러그인 `login()` 함수가 device_id 전송
- [ ] connect-modal.ts login 호출부 업데이트
- [ ] jwt-auth.ts 헬퍼에 device_id 포함
- [ ] 전체 테스트 스위트 통과 (회귀 없음)
- [ ] TypeScript 타입 체크 통과
- [ ] ESLint 통과
- [ ] 테스트 커버리지 85% 이상
