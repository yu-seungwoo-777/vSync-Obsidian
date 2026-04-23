## Task Decomposition
SPEC: SPEC-JWT-DEVICE-BINDING-001

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | JwtPayload에 device_id 추가, 만료 제거 | REQ-DB-001, DB-002 | - | packages/server/src/services/jwt.ts, tests | pending |
| T-002 | Auth 미들웨어 device_id 검증 | REQ-DB-004, DB-009 | T-001 | packages/server/src/services/auth.ts, tests | pending |
| T-003 | Login 라우트 device_id 수락 | REQ-DB-003 | T-001 | packages/server/src/routes/v1.ts, tests | pending |
| T-004 | Plugin login + connect-modal device_id 전송 | REQ-DB-005 | T-003 | packages/plugin/src/api-client.ts, packages/plugin/src/ui/connect-modal.ts | pending |
| T-005 | 테스트 인프라 업데이트 (jwt-auth.ts + 4개 파일) | 회귀 방지 | T-001~T-004 | packages/server/tests/helpers/jwt-auth.ts, auth.test.ts 등 | pending |
