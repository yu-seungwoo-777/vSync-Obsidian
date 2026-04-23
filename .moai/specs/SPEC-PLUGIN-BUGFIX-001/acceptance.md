---
id: SPEC-PLUGIN-BUGFIX-001
version: 1.0.0
status: draft
created_at: 2026-04-22
updated: 2026-04-22
author: moai
priority: critical
labels: [bugfix, plugin, obsidian, typescript]
---

# 인수 테스트: SPEC-PLUGIN-BUGFIX-001

## 품질 게이트

모든 인수 테스트가 통과해야 구현이 완료된 것으로 간주한다:

- [ ] `tsc --noEmit` 컴파일 에러 0건
- [ ] `vitest run` 전체 테스트 통과
- [ ] 기존 테스트 회귀 0건
- [ ] 신규 테스트 커버리지: 각 REQ당 최소 1개 테스트
- [ ] ESLint 경고 0건 (설정된 경우)
- [ ] Exclusions에 명시된 항목이 구현되지 않았음을 확인

---

## Module 1: Critical Bug Fixes

### REQ-001: 오프라인 큐 복원 프로퍼티명 불일치

**시나리오 1: 올바른 프로퍼티명으로 큐 복원**

```
Given localStorage에 retryCount가 3인 OfflineQueueItem이 저장되어 있다
When 플러그인이 시작되어 _isValidQueueItem을 호출하면
Then 해당 항목은 유효한 것으로 판별되어 큐에 복원된다
```

**시나리오 2: 잘못된 프로퍼티명으로 인한 복원 실패 (회귀 방지)**

```
Given localStorage에 retry_count(snake_case)만 존재하는 항목이 있다
When _isValidQueueItem이 해당 항목을 검증하면
Then 해당 항목은 무효로 처리되어 큐에서 제외된다
```

**시나리오 3: 혼합 항목 복원**

```
Given localStorage에 유효한 항목 3개와 무효한 항목 1개가 저장되어 있다
When 플러그인이 시작되어 큐를 복원하면
Then 유효한 3개 항목만 큐에 복원되고 무효 항목은 제외된다
```

---

### REQ-002: deleteFile 경로 인코딩

**시나리오 1: 한글 파일명 삭제**

```
Given 서버에 "문서/대한민국.md" 파일이 존재한다
When deleteFile("문서/대한민국.md")가 호출되면
Then API 요청 URL에 encodeURIComponent가 적용되어 파일이 정상 삭제된다
```

**시나리오 2: 공백 포함 파일명 삭제**

```
Given 서버에 "my notes/daily note.md" 파일이 존재한다
When deleteFile("my notes/daily note.md")가 호출되면
Then API 요청 URL의 공백이 "%20"으로 인코딩되어 파일이 정상 삭제된다
```

**시나리오 3: 특수문자 포함 파일명 삭제**

```
Given 서버에 "files/C++ & Java.md" 파일이 존재한다
When deleteFile("files/C++ & Java.md")가 호출되면
Then API 요청 URL의 "&"와 "+"가 올바르게 인코딩되어 파일이 정상 삭제된다
```

**시나리오 4: 인코딩 일관성 검증**

```
Given rawUpload, rawDownload, uploadAttachment, deleteFile 메서드가 있다
When 각 메서드의 URL 구성 로직을 비교하면
Then 모든 메서드가 동일하게 encodeURIComponent를 적용한다
```

---

### REQ-003: 타입 이중 정의 해결

**시나리오 1: 단일 타입 소스 검증**

```
Given types.ts에 ConflictQueueItem이 정의되어 있다
When conflict.ts에서 해당 타입을 export하면
Then main.ts와 다른 모듈에서 임포트 시 동일한 타입 인스턴스를 참조한다
```

**시나리오 2: 임포트 경로 정상 동작**

```
Given conflict.ts가 types.ts에서 ConflictQueueItem을 재export한다
When main.ts에서 import type { ConflictQueueItem } from './conflict'을 실행하면
Then TypeScript 컴파일 에러 없이 정상 임포트된다
```

**시나리오 3: 타입 호환성 검증**

```
Given API 응답이 types.ts의 ConflictQueueItem 형식을 따른다
When 해당 응답이 conflict.ts의 ConflictQueueItem으로 처리되면
Then 타입 에러 없이 정상 처리된다
```

---

## Module 2: Security Fix

### REQ-004: 평문 비밀번호 제거

**시나리오 1: 로그인 성공 후 비밀번호 초기화**

```
Given 사용자가 올바른 자격증명으로 로그인에 성공했다
When 세션 토큰이 발급되어 설정에 저장되면
Then settings.password는 빈 문자열("")이다
```

**시나리오 2: data.json에 비밀번호 미저장**

```
Given 로그인이 완료되어 세션이 활성 상태이다
When saveSettings()가 호출되면
Then data.json 파일에 password 필드가 빈 문자열로 저장된다
```

**시나리오 3: 세션 만료 시 재인증**

```
Given 세션 토큰이 만료되었다
When API 요청이 인증 실패를 반환하면
Then 사용자에게 비밀번호 재입력을 요청하는 로그인 모달이 표시된다
```

**시나리오 4: 기존 저장된 비밀번호 정리**

```
Given 기존 data.json에 평문 비밀번호가 저장되어 있다
When 플러그인이 로드되어 세션 토큰이 유효한 것으로 확인되면
Then settings.password가 빈 문자열로 초기화된다
```

---

## Module 3: Code Quality — Naming

### REQ-005: private 필드 _camelCase 통일

**시나리오 1: api-client.ts 필드명 변경**

```
Given api-client.ts에 _base_url, _vault_id, _device_id 필드가 있다
When 명명 규칙을 _camelCase로 통일하면
Then 필드명이 _baseUrl, _vaultId, _deviceId로 변경되고 모든 참조가 업데이트된다
```

**시나리오 2: 컴파일 검증**

```
Given 모든 private 필드가 _camelCase로 변경되었다
When tsc --noEmit을 실행하면
Then 컴파일 에러가 0건이다
```

**시나리오 3: 전체 테스트 통과**

```
Given 명명 변경이 모든 파일에 적용되었다
When vitest run을 실행하면
Then 기존 테스트가 모두 통과한다
```

---

### REQ-006: sync-logger.ts 메서드 명명

**시나리오 1: 메서드명 변경**

```
Given sync-logger.ts에 get_all(), on_update() 메서드가 있다
When camelCase로 명명을 통일하면
Then getAll(), onUpdate()로 변경되고 모든 호출 지점이 업데이트된다
```

**시나리오 2: 호출 지점 업데이트**

```
Given main.ts에서 syncLogger.get_all()을 호출한다
When 메서드명이 getAll()로 변경되면
Then 호출 지점도 syncLogger.getAll()로 업데이트된다
```

---

## Module 4: Logic Fixes

### REQ-007: _tryAutoMerge serverContent 사용

**시나리오 1: 기본 병합 — server 내용 있음**

```
Given localContent가 "로컬 내용"이고 serverContent가 "서버 내용"이다
When _tryAutoMerge가 호출되면
Then serverContent가 병합 로직에 반영되어 업로드된다
```

**시나리오 2: 빈 local 내용**

```
Given localContent가 ""이고 serverContent가 "서버 내용"이다
When _tryAutoMerge가 호출되면
Then server 내용이 보존되어 업로드된다
```

**시나리오 3: 빈 server 내용**

```
Given localContent가 "로컬 내용"이고 serverContent가 ""이다
When _tryAutoMerge가 호출되면
Then local 내용이 보존되어 업로드된다
```

**시나리오 4: 병합 실패 시 fallback**

```
Given _tryAutoMerge가 예외를 발생시키는 상황이다
When 병합이 실패하면
Then false를 반환하고 충돌 해결 프로세스로 이관된다
```

---

### REQ-008: null App 처리

**시나리오 1: null App에서 안전한 기본 해결**

```
Given App 인스턴스가 null인 상황이다
When handleMergeConflict가 호출되면
Then 모달 생성을 건너뛰고 기본 충돌 해결(server 우선)을 수행한다
```

**시나리오 2: 유효한 App에서 모달 표시**

```
Given 유효한 App 인스턴스가 있다
When handleMergeConflict가 호출되면
Then 충돌 해결 모달이 정상적으로 표시된다
```

**시나리오 3: null App에서 예외 미발생**

```
Given App 인스턴스가 null이다
When handleMergeConflict가 실행되면
Then TypeError나 Cannot read property of null 예외가 발생하지 않는다
```

---

### REQ-009: 바이너리 파일 큐 드롭 알림

**시나리오 1: 단일 바이너리 파일 알림**

```
Given 오프라인 큐에 1개의 ArrayBuffer 항목과 3개의 텍스트 항목이 있다
When _persistQueue가 호출되면
Then 3개의 텍스트 항목만 저장되고 1개의 바이너리 항목이 필터링되어 사용자에게 Notice가 표시된다
```

**시나리오 2: 여러 바이너리 파일 알림**

```
Given 오프라인 큐에 3개의 ArrayBuffer 항목이 있다
When _persistQueue가 호출되면
Then 알림 메시지에 "3개 파일"이 포함된다
```

**시나리오 3: 바이너리 파일 없음 — 알림 없음**

```
Given 오프라인 큐에 텍스트 항목만 있다
When _persistQueue가 호출되면
Then 바이너리 관련 Notice가 표시되지 않는다
```

---

## Module 5: Minor Cleanups

### REQ-010: 들여쓰기 일관성

**시나리오 1: 4-공백 들여쓰기 검증**

```
Given main.ts의 모든 코드 블록이 있다
When 들여쓰기를 검사하면
Then 모든 중첩 블록이 4-공백 단위로 일관되게 들여쓰기되어 있다
```

---

### REQ-011: 중복 타입 어노테이션 제거

**시나리오 1: 타입 어노테이션 제거 후 정상 동작**

```
Given _findQueueItem에 (i: ConflictQueueItem) 명시적 어노테이션이 있다
When 해당 어노테이션을 제거하면
Then TypeScript가 자동 추론하여 tsc --noEmit이 통과한다
```

---

### REQ-012: contentType 헤더 표준화

**시나리오 1: updateSyncStatus 헤더 표준화**

```
Given updateSyncStatus가 'Content-Type' 헤더를 사용한다
When contentType 프로퍼티로 변경하면
Then 기능이 동일하게 동작하고 tsc --noEmit이 통과한다
```

**시나리오 2: 전체 메서드 일관성 검증**

```
Given api-client.ts의 모든 HTTP 메서드가 있다
When 콘텐츠 타입 지정 방식을 검사하면
Then 모든 메서드가 contentType 프로퍼티를 사용한다
```

---

## Edge Cases

### 공통 에지 케이스

1. **빈 큐 복원**: localStorage에 항목이 없는 경우 정상 처리
2. **URL에 이미 인코딩된 경로**: 이중 인코딩 방지 확인
3. **빈 비밀번호로 로그인 시도": 빈 문자열 입력 시 적절한 에러 처리
4. **동시성**: 동기화 진행 중 큐 복원이 발생하는 경우
5. **대용량 파일**: 큰 ArrayBuffer 항목이 큐에 있는 경우 메모리 관리

### 회귀 방지

| 시나리오 | 검증 항목 |
|---------|----------|
| 기존 동기화 플로우 | 명명 변경 후 동기화가 정상 동작 |
| 기존 충돌 해결 | 타입 통합 후 충돌 해결 UI 정상 |
| 기존 설정 로드 | password 초기화 후 설정 로드 정상 |
| 기존 API 호출 | deleteFile 외 메서드 영향 없음 |

---

## Definition of Done

- [ ] 모듈 1-5의 모든 Given/When/Then 시나리오 통과
- [ ] `tsc --noEmit` 컴파일 에러 0건
- [ ] `vitest run` 전체 테스트 통과
- [ ] 신규 테스트가 각 REQ에 대해 최소 1개 이상 작성됨
- [ ] Exclusions에 명시된 항목이 구현에서 제외됨
- [ ] @MX 태그가 plan.md에 명시된 위치에 추가됨
- [ ] 기존 기능에 회귀가 없음
- [ ] ESLint 검증 통과 (설정된 경우)
