---
id: SPEC-PLUGIN-BUGFIX-001
version: 1.0.0
status: draft
created_at: 2026-04-22
updated: 2026-04-22
author: moai
priority: critical
issue_number: 0
labels: [bugfix, plugin, obsidian, typescript]
---

# SPEC-PLUGIN-BUGFIX-001: Obsidian 플러그인 12건 버그 수정

## 개요

본 SPEC은 `packages/plugin/src/` 내 Obsidian vSync 플러그인 코드베이스에서 발견된 12건의 버그 및 코드 품질 이슈를 5개 모듈로 분류하여 체계적으로 수정하는 것을 목적으로 한다.

### 배경

코드 분석 결과 오프라인 큐 복원 실패, 파일 삭제 경로 인코딩 누락, 타입 이중 정의 등 코어 동기화 기능에 영향을 미치는 치명적 버그부터 보안 취약점, 명명 규칙 불일치까지 광범위한 이슈가 확인되었다.

### 범위

- **대상 모듈**: packages/plugin/src/ 전체
- **대상 테스트**: packages/plugin/tests/
- **관련 SPEC**: SPEC-TYPE-SAFETY-001, SPEC-API-GAP-COMBINED-001 (참조용)

### 수정 파일 목록

| 파일 | 관련 요구사항 | 수정 유형 |
|------|-------------|-----------|
| `main.ts` | REQ-001, REQ-009, REQ-010, REQ-011 | [MODIFY] |
| `api-client.ts` | REQ-002, REQ-005, REQ-012 | [MODIFY] |
| `types.ts` | REQ-003 | [MODIFY] |
| `conflict.ts` | REQ-003, REQ-008 | [MODIFY] |
| `ui/connect-modal.ts` | REQ-004 | [MODIFY] |
| `sync-engine.ts` | REQ-007, REQ-005 | [MODIFY] |
| `sync-logger.ts` | REQ-006 | [MODIFY] |
| `settings.ts` | REQ-005 | [MODIFY] |
| `services/ws-client.ts` | REQ-005 | [MODIFY] |
| `tests/**/*.test.ts` | 전체 요구사항 테스트 | [MODIFY]/[NEW] |

---

## HISTORY

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|----------|--------|
| 1.0.0 | 2026-04-22 | 최초 작성 — 12건 버그/이슈 EARS 명세 | moai |

---

## Module 1: Critical Bug Fixes (Priority: Critical)

### REQ-001: 오프라인 큐 복원 프로퍼티명 불일치 수정

**상태**: [MODIFY] main.ts

**문제**: `_isValidQueueItem` 검증 함수가 `retry_count`(snake_case)를 확인하지만, `OfflineQueueItem` 타입은 `retryCount`(camelCase)를 정의하고 있다. 이로 인해 플러그인 재시작 시 모든 큐 항목이 검증에 실패하여 오프라인 동기화 지속성이 완전히 손상된다.

**EARS 명세**:

> **WHEN** 플러그인이 시작되고 오프라인 큐가 localStorage에서 복원될 때,
> **the system shall** `OfflineQueueItem` 타입에 정의된 프로퍼티를 사용하여 각 항목을 검증한다.

> **IF** 검증 함수가 `retry_count`(snake_case) 대신 `retryCount`(camelCase)를 확인하지 않으면,
> **THEN** 복원된 모든 큐 항목이 무효로 처리되어 오프라인 동기화가 실패한다.

**수정 위치**: `main.ts:622` — `_isValidQueueItem` 메서드 내 `obj.retry_count` → `obj.retryCount` 변경

**참조**: research.md Issue 1

---

### REQ-002: deleteFile 경로 인코딩 누락 수정

**상태**: [MODIFY] api-client.ts

**문제**: `rawUpload`, `rawDownload`, `uploadAttachment`는 `encodeURIComponent(path)`를 사용하지만, `deleteFile` 메서드는 인코딩 없이 원본 경로를 사용한다. 공백, 한글, 특수문자가 포함된 파일명에서 삭제가 실패한다.

**EARS 명세**:

> **WHEN** `deleteFile` 메서드가 파일 경로로 API URL을 구성할 때,
> **the system shall** 파일 경로를 URL 안전하게 인코딩한다.

> **IF** 파일 경로에 공백, 한글, 또는 URL 예약 문자가 포함된 경우,
> **THEN** 인코딩되지 않은 경로는 서버에서 404 또는 잘못된 파일 참조를 유발한다.

**수정 위치**: `api-client.ts:316` — `buildApiUrl` 호출 시 `path` → `encodeURIComponent(path)` 변경

**참조**: research.md Issue 2

---

### REQ-003: ConflictQueueItem/DiffOperation 이중 타입 정의 해결

**상태**: [MODIFY] types.ts, conflict.ts

**문제**: `ConflictQueueItem`과 `DiffOperation` 타입이 `types.ts`(API 파생)와 `conflict.ts`(내부용)에 각각 중복 정의되어 있다. `main.ts`는 `conflict.ts`에서 임포트하지만 API 연산은 `types.ts` 기반을 기대하여 타입 안전성 위반이 발생한다.

**EARS 명세**:

> **The system shall** `ConflictQueueItem` 및 `DiffOperation` 타입의 단일 정의를 단일 소스 위치에 유지하고, `conflict.ts`는 해당 타입을 단일 소스에서 재export(import)한다.

> **WHEN** 모듈이 `ConflictQueueItem` 또는 `DiffOperation` 타입을 참조할 때,
> **the system shall** 항상 동일한 소스의 타입 정의를 사용한다.

**수정 위치**:
- `types.ts`: 기존 타입 정의 유지 (단일 소스)
- `conflict.ts`: 내부 타입 정의를 제거하고 `types.ts`에서 `export type { ConflictQueueItem, DiffOperation }` 재export

**참조**: research.md Issue 3, 추가 발견 B

---

## Module 2: Security Fix (Priority: High)

### REQ-004: 성공적 로그인 후 설정에서 평문 비밀번호 제거

**상태**: [MODIFY] ui/connect-modal.ts

**문제**: 로그인 성공 후 세션 토큰이 발급되었음에도 비밀번호가 `VSyncSettings.password`에 평문으로 저장된다. `data.json`에 평문 자격증명이 노출되는 보안 취약점이다.

**EARS 명세**:

> **WHEN** 사용자가 로그인에 성공하고 세션 토큰이 발급되면,
> **the system shall** 설정 객체에서 `password` 필드를 빈 문자열(`""`)로 초기화한다.

> **The system shall not** 세션 토큰이 활성화된 상태에서 비밀번호를 `data.json`에 평문으로 저장한다.

> **IF** 세션 토큰이 만료되어 재인증이 필요한 경우,
> **THEN** 사용자에게 비밀번호 재입력을 요청하는 로그인 모달을 표시한다.

**수정 위치**: `ui/connect-modal.ts:293-299` — 설정 객체에서 `password` 필드 제거 또는 빈 문자열 설정

**참조**: research.md Issue 4, 추가 발견 A

---

## Module 3: Code Quality — Naming Standardization (Priority: Medium)

### REQ-005: private 필드 명명 규칙 _camelCase 통일

**상태**: [MODIFY] api-client.ts, sync-engine.ts, settings.ts, services/ws-client.ts

**문제**: private 필드 명명이 `_camelCase`(권장)와 `_snake_case`(비일관)가 혼재되어 있다. 코드의 20%가 `_snake_case`를 사용 중이다.

**위반 필드 목록**:
- `api-client.ts`: `_base_url` → `_baseUrl`, `_vault_id` → `_vaultId`, `_device_id` → `_deviceId`
- `sync-engine.ts`: `_base_url` → `_baseUrl`, `_vault_id` → `_vaultId`
- `settings.ts`: 확인 필요 필드 존재 시 동일 규칙 적용
- `services/ws-client.ts`: 확인 필요 필드 존재 시 동일 규칙 적용

**EARS 명세**:

> **The system shall** 모든 private 클래스 필드에 `_camelCase` 명명 규칙을 일관되게 적용한다.

> **IF** 기존 코드가 `_snake_case` private 필드를 사용하는 경우,
> **THEN** 해당 필드명을 `_camelCase`로 변경하고 모든 참조 지점을 업데이트한다.

**수정 위치**: 각 파일의 private 필드 선언 및 참조 전체

**참조**: research.md Issue 5

---

### REQ-006: sync-logger.ts 메서드 명명 camelCase 통일

**상태**: [MODIFY] sync-logger.ts

**문제**: `sync-logger.ts`가 `get_all()`, `on_update()` 등 snake_case 메서드를 사용하는 반면, 다른 클래스는 `getAll()`, `onUpdate()` 등 camelCase를 사용한다.

**EARS 명세**:

> **WHEN** `sync-logger.ts`의 공개 메서드가 정의될 때,
> **the system shall** camelCase 명명 규칙을 따른다.

> **IF** 기존 코드가 snake_case 메서드를 호출하는 경우,
> **THEN** 해당 호출 지점도 camelCase로 업데이트한다.

**수정 위치**: `sync-logger.ts` — `get_all` → `getAll`, `on_update` → `onUpdate` 및 모든 호출 지점

**참조**: research.md Issue 6

---

## Module 4: Logic Fixes (Priority: High)

### REQ-007: _tryAutoMerge에서 serverContent 실제 사용

**상태**: [MODIFY] sync-engine.ts

**문제**: `_tryAutoMerge` 메서드가 `serverContent` 파라미터를 완전히 무시하고 `localContent`만 사용한다. 진정한 3-way merge가 아닌 단순 local 우선 덮어쓰기이다.

**EARS 명세**:

> **WHEN** `_tryAutoMerge`가 호출되면,
> **the system shall** `localContent`와 `serverContent`를 모두 활용하여 병합을 수행한다.

> **IF** 자동 병합이 불가능한 경우(충돌 감지),
> **THEN** `false`를 반환하고 충돌 해결 프로세스로 이관한다.

**수정 위치**: `sync-engine.ts:158-169` — 병합 로직 수정

**참고**: 실제 3-way merge 구현이 복잡할 경우, 최소한 serverContent를 기반으로 한 기본 병합 전략(예: server 우선 또는 줄 단위 결합)을 적용해야 한다.

**참조**: research.md Issue 7

---

### REQ-008: handleMergeConflict의 null App 처리

**상태**: [MODIFY] conflict.ts

**문제**: `conflict.ts:205`에서 `null as unknown as App`을 사용하여 모달 인스턴스를 생성한다. 모달이 App 메서드를 호출하면 런타임 에러가 발생한다.

**EARS 명세**:

> **WHEN** `handleMergeConflict`가 UI 컨텍스트 없이 호출되는 경우,
> **the system shall** 유효한 `App` 인스턴스를 전달하거나 null 케이스를 안전하게 처리한다.

> **IF** `App` 인스턴스가 null이면,
> **THEN** 모달 생성을 건너뛰고 프로그래매틱한 기본 충돌 해결(server 우선 또는 local 우선)을 수행한다.

**수정 위치**: `conflict.ts:204-205` — null 가드 추가 및 대체 경로 구현

**참조**: research.md Issue 8

---

### REQ-009: 바이너리 파일 큐 드롭 시 사용자 알림

**상태**: [MODIFY] main.ts

**문제**: `_persistQueue`에서 ArrayBuffer 콘텐츠가 직렬화 불가하여 필터링되지만, 사용자에게 어떠한 알림도 제공되지 않는다. 재시작 후 바이너리 파일이 조용히 누락된다.

**EARS 명세**:

> **WHEN** 오프라인 큐에서 바이너리(ArrayBuffer) 항목이 필터링되면,
> **the system shall** Obsidian Notice를 통해 사용자에게 필터링된 파일 수와 파일명을 알린다.

> **IF** 하나 이상의 바이너리 파일이 큐에서 제외되면,
> **THEN** 알림 메시지에 제외된 파일 수를 포함한다.

**수정 위치**: `main.ts:591-602` — `_persistQueue` 메서드 내 필터링 후 Notice 추가

**참조**: research.md Issue 10

---

## Module 5: Minor Cleanups (Priority: Low)

### REQ-010: main.ts 들여쓰기 불일치 수정

**상태**: [MODIFY] main.ts

**문제**: `main.ts` 382-399줄과 508-513줄에서 들여쓰기 수준이 일관되지 않는다 (4-공백과 8-공백 혼재).

**EARS 명세**:

> **The system shall** `main.ts`의 모든 코드 블록에 4-공백 들여쓰기를 일관되게 적용한다.

**수정 위치**: `main.ts:508-513` — 8-공백 들여쓰기를 4-공백으로 수정

**참조**: research.md Issue 9

---

### REQ-011: _findQueueItem 중복 타입 어노테이션 제거

**상태**: [MODIFY] main.ts

**문제**: `_findQueueItem`의 `.find()` 콜백 파라미터에 `(i: ConflictQueueItem)` 타입 어노테이션이 불필요하게 명시되어 있다. TypeScript가 자동 추론 가능하다.

**EARS 명세**:

> **WHEN** TypeScript가 콜백 파라미터 타입을 자동 추론할 수 있는 경우,
> **the system shall** 명시적 타입 어노테이션을 생략한다.

**수정 위치**: `main.ts:243` — `(i: ConflictQueueItem)` → `(i)` 또는 생략

**참조**: research.md Issue 11

---

### REQ-012: contentType/Content-Type 헤더 사용 표준화

**상태**: [MODIFY] api-client.ts

**문제**: `rawUpload`와 `uploadAttachment`는 `contentType` 프로퍼티를, `updateSyncStatus`는 `Content-Type` 헤더를 사용한다. Obsidian `requestUrl`은 두 형태 모두 지원하지만 일관성이 없다.

**EARS 명세**:

> **WHEN** HTTP 요청에 콘텐츠 타입을 지정할 때,
> **the system shall** `contentType` 프로퍼티를 일관되게 사용한다.

**수정 위치**: `api-client.ts` — `updateSyncStatus`의 `'Content-Type': 'application/json'` → `contentType: 'application/json'`

**참조**: research.md Issue 12

---

## Exclusions (What NOT to Build)

다음 항목은 본 SPEC의 범위에서 **명시적으로 제외**한다:

1. **3-way merge 알고리즘 구현**: REQ-007에서 기본 병합 로직만 수정하며, 완전한 diff 기반 3-way merge 알고리즘은 별도 SPEC으로 다룬다.
2. **비밀번호 암호화/해싱 구현**: REQ-004은 평문 비밀번호 제거에 한정하며, bcrypt 등 해싱 도입은 별도 보안 SPEC에서 다룬다.
3. **에러 처리 패턴 통일**: research.md에서 발견된 HTTP 메서드 간 에러 처리 불일치는 본 SPEC 범위 외이다.
4. **ArrayBuffer 직렬화 대안 구현**: REQ-009은 사용자 알림에 한정하며, 바이너리 파일 직렬화(예: Base64 변환)는 별도 SPEC에서 다룬다.
5. **API 타입 전체 리팩토링**: `types.ts` 내 snake_case API 파생 필드명을 camelCase로 변환하는 작업은 본 SPEC 범위 외이다 (API 계약 변경 필요).
6. **sync-logger.ts 외부 소비자 호환성 레이어**: REQ-006에서 메서드명 변경 시 모든 호출 지점을 직접 업데이트하며, 별칭(alias) 레이어는 제공하지 않는다.
