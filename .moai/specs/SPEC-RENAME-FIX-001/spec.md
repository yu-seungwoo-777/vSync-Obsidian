# SPEC-RENAME-FIX-001

## 메타데이터

| 항목 | 값 |
|------|-----|
| ID | SPEC-RENAME-FIX-001 |
| 제목 | Obsidian rename 이벤트를 활용한 파일명 변경 동기화 수정 |
| 우선순위 | High |
| 영역 | packages/plugin |
| 관련 | REQ-PA-004 (기존 RenameDetector) |
| 상태 | completed |
| 완료일 | 2026-04-21 |

---

## 1. 문제 서술

사용자가 Obsidian에서 문서 제목을 변경하면, 서버 DB에 기존 문서가 소프트 삭제되고 **새로운 별개의 문서로 생성**됨. 버전 히스토리가 단절되고, 동일 문서임에도 두 개의 레코드가 존재하게 됨.

### 근본 원인

1. 파일 식별이 `vaultId + path` 기반이므로 경로가 바뀌면 완전히 새 파일로 인식됨
2. 플러그인이 `vault.on('create')`, `vault.on('modify')`, `vault.on('delete')`만 구독하고 있음
3. `vault.on('rename')` 이벤트를 **구독하지 않음** — Obsidian API는 rename 시 `(file, oldPath)`를 정확히 제공함
4. 현재 `RenameDetector` 클래스(500ms 윈도우 + 해시 매칭 휴리스틱)로 보완하려 하지만 타이밍/해시 조건으로 자주 실패함

### 영향 범위

| 파일 | 역할 |
|------|------|
| `packages/plugin/src/sync-engine.ts` | RenameDetector 클래스(25-77행), start()(984-988행), VaultAdapter 인터페이스(1053-1065행) |
| `packages/plugin/src/main.ts` | VaultAdapter 생성(552-667행), _startSync()(349-359행) |
| `packages/plugin/tests/unit/sync-engine.test.ts` | 리네임 감지 테스트(1043-1093행) |
| `packages/plugin/tests/mocks/vault.ts` | Vault mock(이미 rename mock 보유, 69-80행) |

---

## 2. 요구사항 (EARS 형식)

### REQ-RN-001: rename 이벤트 구독

**SyncEngine은** `vault.on('rename')` 이벤트를 **구독해야 한다 (shall)**

- 이벤트 콜백: `(file: TAbstractFile, oldPath: string) => void`
- oldPath: 변경 전 파일 경로
- file.path: 변경 후 파일 경로

### REQ-RN-002: handleLocalRename 메서드

**SyncEngine은** `handleLocalRename(oldPath: string, newPath: string)` 메서드를 **구현해야 한다 (shall)**

동작:
1. `shouldSyncPath(newPath)`가 false면 스킵
2. `_is_syncing` 또는 `_recently_modified`에 있으면 스킵
3. `shouldSyncPath(oldPath)`가 true면 `POST /move` API 호출: `client.moveFile(oldPath, newPath)`
4. 성공 시: `_hash_cache`에서 oldPath 삭제, newPath에 기존 해시 이관
5. 실패 시: Notice로 에러 표시 (기존 delete+create 흐름에 의해 자연스럽게 처리됨)

### REQ-RN-003: VaultAdapter 인터페이스 확장

**VaultAdapter 인터페이스는** rename 이벤트를 **지원해야 한다 (shall)**

기존 `on(event: string, ...)` 시그니처는 유지하되, `handleLocalRename`에서 직접 `moveFile`을 호출하므로 VaultAdapter에 rename 전용 메서드는 불필요함. rename 이벤트는 기존 `on('rename', handler)`로 전달됨.

### REQ-RN-004: RenameDetector 제거

**RenameDetector 클래스는 제거해야 한다 (shall)**

- `RenameDetector` 클래스 전체 삭제 (sync-engine.ts 25-77행)
- `_rename_detector` 필드 삭제 (sync-engine.ts 114행)
- 생성자 내 `_rename_detector` 초기화 삭제 (sync-engine.ts 126행)
- `handleLocalCreate` 내 리네임 감지 로직 삭제 (sync-engine.ts 311-331행)
- `handleLocalDelete` 내 `recordDelete` 로직 삭제 (sync-engine.ts 361-373행)
- `destroy()` 내 `_rename_detector.clear()` 삭제

이유:
- rename 이벤트가 정확한 정보를 제공하므로 휴리스틱 불필요
- false positive/negative 가능성 제거
- 약 50줄 코드 감소

### REQ-RN-005: 기존 테스트 갱신

**기존 RenameDetector 테스트는** `handleLocalRename` 테스트로 **교체되어야 한다 (shall)**

- `sync-engine.test.ts`의 "리네임 감지 (REQ-PA-004, T-009)" describe 블록 전면 교체
- 새 테스트: `handleLocalRename` 직접 호출로 `moveFile` API 검증
- Vault mock의 `trigger('rename', file, oldPath)` 활용

---

## 3. 인수 기준 (Acceptance Criteria)

### AC-001: rename 이벤트로 서버 moveFile 호출

**Given** SyncEngine이 시작되고 vault 이벤트를 구독 중일 때
**When** Obsidian에서 파일명 변경 발생 (예: `old.md` → `new.md`)
**Then** `client.moveFile('old.md', 'new.md')`가 호출됨

### AC-002: rename 성공 시 해시 캐시 이관

**Given** `_hash_cache`에 `old.md → hash-abc`가 있을 때
**When** `handleLocalRename('old.md', 'new.md')`가 성공적으로 완료되면
**Then** `_hash_cache`에서 `old.md`가 삭제되고 `new.md → hash-abc`가 등록됨

### AC-003: rename 실패 시 graceful degradation

**Given** 서버 /move API가 에러를 반환할 때
**When** `handleLocalRename`이 실패하면
**Then** Notice로 에러 메시지가 표시되고, 이후 Obsidian이 발생시킨 delete+create 이벤트에 의해 기존 흐름대로 처리됨

### AC-004: 동기화 대상이 아닌 파일 스킵

**Given** `.obsidian/` 경로의 파일이거나 허용되지 않은 확장자일 때
**When** rename 이벤트가 발생하면
**Then** `moveFile`이 호출되지 않음

### AC-005: 바이너리 파일 rename 지원

**Given** 바이너리 파일(예: `image.png`)의 이름이 변경될 때
**When** `handleLocalRename('old.png', 'new.png')`가 호출되면
**Then** `moveFile('old.png', 'new.png')`가 정상적으로 호출됨

### AC-006: RenameDetector 코드 완전 제거

**Given** 변경 사항이 적용된 후
**When** `sync-engine.ts`에서 `RenameDetector` 클래스를 검색하면
**Then** 결과가 0건이어야 함

### AC-007: 기존 기능 회귀 없음

**Given** 변경 사항이 적용된 후
**When** 기존 create/modify/delete 동기화 테스트를 실행하면
**Then** 모든 기존 테스트가 통과해야 함

---

## 4. 변경 파일 상세

### 4.1 `packages/plugin/src/sync-engine.ts`

**삭제:**
- 25-77행: `RenameDetector` 클래스 전체
- 114행: `_rename_detector` 필드
- 126행: `this._rename_detector = new RenameDetector(noticeFn)` 초기화
- 307-333행: `handleLocalCreate` 내 리네임 감지 로직 (311-331행)
- 361-373행: `handleLocalDelete` 내 `recordDelete` 로직

**추가:**
- `handleLocalRename(oldPath: string, newPath: string)` 메서드
- `start()` 메서드(984-988행)에 `vault.on('rename', ...)` 구독 추가

**수정:**
- `handleLocalCreate` 메서드: 리네임 감지 분기 제거, `_uploadLocalFile` 직접 호출로 단순화

### 4.2 `packages/plugin/src/main.ts`

**수정 불필요** — VaultAdapter의 `on()` 메서드가 이미 제네릭하게 `vault.on(event, handler)`를 래핑하므로 `rename` 이벤트도 자동 전달됨.

### 4.3 `packages/plugin/tests/unit/sync-engine.test.ts`

**삭제:**
- 1043-1110행: 기존 "리네임 감지" describe 블록 전체

**추가:**
- `handleLocalRename` 단위 테스트:
  - 정상 rename → moveFile 호출
  - 동기화 대상이 아닌 파일 → 스킵
  - syncing 중 → 스킵
  - moveFile 실패 → Notice + graceful degradation
  - 해시 캐시 이관 검증

### 4.4 `packages/plugin/tests/mocks/vault.ts`

**수정 불필요** — 이미 `rename` mock과 `trigger` 헬퍼를 보유하고 있음.

---

## 5. 위험 및 완화

| 위험 | 확률 | 영향 | 완화 |
|------|------|------|------|
| rename 이벤트가 동기화 중에 발생 | 중 | 낮음 | `_is_syncing` 체크로 스킵 |
| Obsidian이 rename 대신 delete+create를 발생시키는 경우 | 낮음 | 중 | delete/create 이벤트는 기존 로직대로 처리됨 (폴백) |
| 바이너리 파일 rename 시 서버 미지원 | 낮음 | 낮음 | 서버 /move API는 파일 타입 무관하게 path만 변경 |

---

## 6. 테스트 계획

### 단위 테스트

| 테스트 | 검증 내용 |
|--------|----------|
| `handleLocalRename → moveFile 호출` | AC-001 |
| `handleLocalRename → 해시 캐시 이관` | AC-002 |
| `handleLocalRename 실패 → Notice` | AC-003 |
| `handleLocalRename → .obsidian 스킵` | AC-004 |
| `handleLocalRename → 바이너리 파일` | AC-005 |
| `RenameDetector 검색 결과 0건` | AC-006 |
| 기존 create/modify/delete 테스트 통과 | AC-007 |
| `start()에서 rename 이벤트 구독` | REQ-RN-001 |
