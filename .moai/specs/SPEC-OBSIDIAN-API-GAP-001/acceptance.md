---
id: SPEC-OBSIDIAN-API-GAP-001
version: "1.0"
status: draft
created: "2026-04-21"
updated: "2026-04-21"
---

# 인수 기준: Obsidian Vault API 공식 메서드 전환

## AC-API-001: onLayoutReady 래핑

### AC-API-001.1: 레이아웃 준비 전 이벤트 무시

**Given** 플러그인이 로드되고 설정이 구성되어 있음
**When** `onload()`가 실행되지만 `onLayoutReady` 콜백이 아직 호출되지 않았을 때
**Then** vault 이벤트 리스너가 등록되지 않았음을 확인한다
**And** `performInitialSync()`가 아직 호출되지 않았음을 확인한다

### AC-API-001.2: 레이아웃 준비 후 동기화 시작

**Given** 플러그인이 로드되고 설정이 구성되어 있음
**When** `onLayoutReady` 콜백이 실행될 때
**Then** vault 이벤트 리스너가 등록된다
**And** `performInitialSync()`가 호출된다
**And** 복원된 오프라인 큐가 있으면 `flushOfflineQueue()`가 호출된다

### AC-API-001.3: 기존 파일에 대한 불필요한 create 이벤트 미발생

**Given** vault에 100개의 기존 파일이 있음
**When** 플러그인이 로드되어 `onLayoutReady` 이후 동기화가 시작될 때
**Then** 기존 100개 파일에 대한 create 이벤트 핸들러가 호출되지 않는다
**And** `performInitialSync()`만이 파일 목록 비교를 수행한다

### AC-API-001.4: 설정 미구성 시 onLayoutReady 미실행

**Given** 플러그인이 로드되었지만 server_url, api_key, vault_id 중 하나가 누락됨
**When** `onload()`가 실행될 때
**Then** `onLayoutReady` 콜백이 등록되지 않는다
**And** 상태가 `not_configured`로 표시된다

---

## AC-API-002: fileManager.renameFile 사용

### AC-API-002.1: moved 이벤트 시 fileManager.renameFile 호출

**Given** 서버에서 `moved` 이벤트를 수신함 (`from_path`가 존재)
**When** `_handleMovedEvent`가 실행될 때
**Then** `vault.write + vault.delete` 대신 `fileManager.renameFile`이 호출된다
**And** wiki link가 자동으로 갱신된다

### AC-API-002.2: rename 실패 시 폴백

**Given** 서버에서 `moved` 이벤트를 수신함
**When** `fileManager.renameFile`이 예외를 발생시킬 때
**Then** 기존 `write + delete` 패턴으로 폴백한다
**And** 에러가 로깅된다

### AC-API-002.3: TFile이 아닌 경우 폴백

**Given** 서버에서 `moved` 이벤트를 수신함
**When** `getAbstractFileByPath`가 `TFile`이 아닌 객체를 반환할 때
**Then** 기존 `write + delete` 패턴으로 폴백한다

---

## AC-API-003: vault.process 원자적 연산

### AC-API-003.1: 업로드 시 원자적 읽기-수정-저장

**Given** 로컬 파일이 변경되어 업로드가 필요함
**When** `_uploadLocalFile`가 실행될 때
**Then** `vault.process`를 통해 읽기-해시계산-비교가 단일 원자적 연산으로 수행된다

### AC-API-003.2: 동시 수정 시 데이터 보존

**Given** 파일 A가 `_uploadLocalFile` 처리 중임
**When** 외부 프로세스가 파일 A를 수정할 때
**Then** `vault.process` 콜백이 재시도되거나 최신 내용으로 안전하게 처리된다

### AC-API-003.3: process 미지원 시 기존 동작 유지

**Given** `vault.process`를 사용할 수 없는 환경
**When** `_uploadLocalFile`가 실행될 때
**Then** 기존 `readIfExists -> computeHash -> rawUpload` 흐름으로 동작한다

---

## AC-API-004: vault.trash 복구 가능한 삭제

### AC-API-004.1: 삭제 시 휴지통 이동

**Given** 원격에서 `deleted` 이벤트를 수신함
**When** `_deleteLocalFile`가 실행될 때
**Then** `vault.trash(file, true)`가 호출된다
**And** 파일이 시스템 휴지통으로 이동한다

### AC-API-004.2: trash 미지원 시 delete로 폴백

**Given** `vault.trash`를 사용할 수 없는 환경
**When** 파일 삭제가 요청될 때
**Then** `vault.delete`로 폴백한다
**And** 폴백 사실이 로깅된다

### AC-API-004.3: moved 이벤트에서 기존 파일 삭제 시 trash 사용

**Given** `_handleMovedEvent`에서 이전 경로의 파일을 삭제해야 함
**When** `_handleMovedEvent`가 실행될 때
**Then** 이전 파일도 `trash`를 통해 삭제된다

---

## AC-API-005: vault.cachedRead 사용

### AC-API-005.1: 해시 비교 시 캐시 우선 활용

**Given** 파일의 메타데이터 캐시가 유효함 (최근 다운로드/수정 없음)
**When** `readIfExists`가 호출될 때
**Then** `vault.cachedRead`가 먼저 시도된다
**And** 캐시가 유효하면 디스크 읽기를 건너뛴다

### AC-API-005.2: 캐시 무효화 후 read 사용

**Given** 파일이 서버에서 방금 다운로드되어 캐시가 무효화됨
**When** `readIfExists`가 호출될 때
**Then** `vault.cachedRead`가 아닌 `vault.read`를 사용한다
**And** 최신 내용을 반환한다

### AC-API-005.3: cachedRead 실패 시 read 폴백

**Given** `vault.cachedRead`가 예외를 발생시킴
**When** `readIfExists`가 실행될 때
**Then** `vault.read`로 폴백한다
**And** 파일 내용을 정상적으로 반환한다

---

## 엣지 케이스

### EC-001: 매우 큰 Vault에서의 onLayoutReady

**시나리오**: 10,000개 이상의 파일이 있는 vault에서 플러그인 로드
**기대 동작**: `onLayoutReady` 이후 `performInitialSync`가 정상적으로 수행되며, 메모리 부족 없이 처리됨

### EC-002: renameFile이 동시에 여러 파일에 적용됨

**시나리오**: 짧은 시간에 여러 moved 이벤트가 큐에 적재됨
**기대 동작**: 각 renameFile이 순차적으로 처리되며, 해시 캐시가 올바르게 이관됨

### EC-003: 휴지통이 가득 찬 상황

**시나리오**: 시스템 휴지통 용량이 부족하여 `trash`가 실패함
**기대 동작**: `delete`로 폴백하며, 에러가 사용자에게 알림으로 표시됨

---

## 품질 게이트

### Definition of Done

- [ ] 모든 5개 요구사항(REQ-API-001 ~ REQ-API-005)이 구현됨
- [ ] 모든 인수 기준(AC-API-001 ~ AC-API-005)의 Given-When-Then 시나리오가 테스트로 구현됨
- [ ] 기존 테스트 전체 통과 (회귀 없음)
- [ ] `npm run typecheck` 타입 에러 없음
- [ ] `npm run lint` 린트 에러 없음
- [ ] 테스트 커버리지 85% 이상 유지
- [ ] Obsidian 공식 API 모범 사례 준수 확인

### 테스트 전략

| 요구사항 | 테스트 유형 | 테스트 파일 |
|----------|-------------|-------------|
| REQ-API-001 | 단위 테스트 | `tests/unit/main.test.ts` |
| REQ-API-002 | 단위 테스트 | `tests/unit/vault-adapter.test.ts`, `tests/unit/sync-engine-reliable.test.ts` |
| REQ-API-003 | 단위 테스트 | `tests/unit/sync-engine-reliable.test.ts` |
| REQ-API-004 | 단위 테스트 | `tests/unit/vault-adapter.test.ts` |
| REQ-API-005 | 단위 테스트 | `tests/unit/vault-adapter.test.ts` |
