---
id: SPEC-PLUGIN-BUGFIX-001
version: 1.0.0
compact: true
created_at: 2026-04-22
labels: [bugfix, plugin, obsidian, typescript]
---

# SPEC-PLUGIN-BUGFIX-001 (Compact)

## REQ 목록

### Module 1: Critical Bug Fixes

**REQ-001** 오프라인 큐 복원 프로퍼티명 불일치
- 수정: `main.ts:622` — `obj.retry_count` → `obj.retryCount`
- EARS: WHEN 큐 복원, SHALL retryCount로 검증
- 인수: 유효 항목 복원 / 무효 항목 제외 / 혼합 항목 처리

**REQ-002** deleteFile 경로 인코딩 누락
- 수정: `api-client.ts:316` — `path` → `encodeURIComponent(path)`
- EARS: WHEN deleteFile URL 구성, SHALL encodeURIComponent 적용
- 인수: 한글 파일명 삭제 / 공백 파일명 삭제 / 특수문자 파일명 / 인코딩 일관성

**REQ-003** ConflictQueueItem/DiffOperation 이중 타입 정의
- 수정: `conflict.ts` — 내부 정의 제거, `types.ts`에서 재export
- EARS: SHALL 단일 타입 소스(types.ts), WHEN 참조 시 동일 소스 사용
- 인수: 단일 소스 검증 / 임포트 정상 / API 호환성

### Module 2: Security Fix

**REQ-004** 로그인 후 평문 비밀번호 제거
- 수정: `ui/connect-modal.ts:293-299` — `password` → `''`
- EARS: WHEN 로그인 성공, SHALL password 초기화; SHALL NOT 평문 저장
- 인수: 로그인 후 빈 문자열 / data.json 미저장 / 세션 만료 재인증 / 기존 비밀번호 정리

### Module 3: Code Quality — Naming

**REQ-005** private 필드 _camelCase 통일
- 수정: `api-client.ts` `_base_url→_baseUrl`, `_vault_id→_vaultId`, `_device_id→_deviceId`; `sync-engine.ts` 동일; `settings.ts`, `ws-client.ts` 확인 후 적용
- EARS: SHALL _camelCase 일관 적용; IF snake_case THEN 변경
- 인수: 필드명 변경 완료 / tsc 통과 / 전체 테스트 통과

**REQ-006** sync-logger.ts 메서드 camelCase 통일
- 수정: `sync-logger.ts` — `get_all→getAll`, `on_update→onUpdate` + 모든 호출 지점
- EARS: WHEN 메서드 정의, SHALL camelCase; IF 호출 시 THEN 업데이트
- 인수: 메서드명 변경 / 호출 지점 업데이트

### Module 4: Logic Fixes

**REQ-007** _tryAutoMerge serverContent 실제 사용
- 수정: `sync-engine.ts:158-169` — 병합 로직에 serverContent 반영
- EARS: WHEN 호출, SHALL local+server 모두 활용; IF 불가 THEN false 반환
- 인수: server 내용 있음 / 빈 local / 빈 server / 병합 실패 fallback

**REQ-008** null App 안전 처리
- 수정: `conflict.ts:204-205` — null 가드 + 대체 경로
- EARS: WHEN null App, SHALL 모달 건너뛰고 기본 해결; IF null THEN 안전 처리
- 인수: null에서 기본 해결 / 유효 App에서 모달 / null에서 예외 미발생

**REQ-009** 바이너리 파일 큐 드롭 알림
- 수정: `main.ts:591-602` — 필터링 후 Notice 추가
- EARS: WHEN ArrayBuffer 필터링, SHALL 사용자에게 알림; IF 제외 시 THEN 파일 수 포함
- 인수: 단일 바이너리 알림 / 여러 바이너리 / 바이너리 없음 시 알림 없음

### Module 5: Minor Cleanups

**REQ-010** main.ts 들여쓰기 4-공백 통일
- 수정: `main.ts:508-513` — 8-공백 → 4-공백

**REQ-011** _findQueueItem 중복 타입 어노테이션 제거
- 수정: `main.ts:243` — `(i: ConflictQueueItem)` → `(i)`

**REQ-012** contentType/Content-Type 표준화
- 수정: `api-client.ts` — `updateSyncStatus`의 `'Content-Type'` → `contentType`

---

## 수정 파일 목록

| 파일 | REQ | 마일스톤 |
|------|-----|---------|
| `main.ts` | 001, 009, 010, 011 | M1, M3, M5 |
| `api-client.ts` | 002, 005, 012 | M1, M4, M5 |
| `types.ts` | 003 | M1 |
| `conflict.ts` | 003, 008 | M1, M3 |
| `ui/connect-modal.ts` | 004 | M2 |
| `sync-engine.ts` | 007, 005 | M3, M4 |
| `sync-logger.ts` | 006 | M4 |
| `settings.ts` | 005 | M4 |
| `services/ws-client.ts` | 005 | M4 |
| `tests/**/*.test.ts` | 전체 | M1-M5 |

---

## 마일스톤 순서

1. **M1 Critical**: 003(타입통합) → 001(큐복원) → 002(인코딩)
2. **M2 Security**: 004(비밀번호제거)
3. **M3 Logic**: 008(null App) → 007(auto-merge) → 009(바이너리알림)
4. **M4 Naming**: 005(필드) + 006(메서드)
5. **M5 Cleanups**: 010 + 011 + 012

---

## Exclusions

1. 3-way merge 알고리즘 구현 (기본 병합만)
2. 비밀번호 암호화/해싱 (평문 제거만)
3. 에러 처리 패턴 통일
4. ArrayBuffer 직렬화 대안 (Base64 등)
5. API 타입 필드명 snake_case→camelCase 변환
6. sync-logger 메서드 별칭(alias) 레이어
