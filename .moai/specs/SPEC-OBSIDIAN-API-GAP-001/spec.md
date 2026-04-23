---
id: SPEC-OBSIDIAN-API-GAP-001
version: "1.0"
status: completed
created: "2026-04-21"
updated: "2026-04-21"
author: manager-spec
priority: high
issue_number: null
---

# SPEC-OBSIDIAN-API-GAP-001: Obsidian Vault API 공식 메서드 전환

## 이력

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| 2026-04-21 | 1.0 | 최초 작성 - 5개 API 갭 분석 및 EARS 요구사항 정의 | manager-spec |

## 배경 및 컨텍스트

Vector 플러그인(`packages/plugin/`)은 Obsidian Vault API를 사용하여 파일 동기화를 수행한다. Obsidian 공식 API 문서에서 권장하는 메서드들이 현재 코드에서 누락되어 있으며, 이로 인해 다음 문제가 발생한다:

1. **Vault 시작 시 불필요한 업로드**: `_startSync()`가 `onLayoutReady` 래핑 없이 직접 호출되어, 기존 파일들이 create 이벤트를 트리거함 (main.ts:113-119)
2. **Wiki link 깨짐**: `vault.rename()` 대신 `vault.rename` 이벤트만 수신하며, 실제 rename 시 `fileManager.renameFile()`을 사용하지 않아 `[[]]` 링크가 갱신되지 않음
3. **레이스 컨디션 위험**: `_uploadLocalFile`에서 read-hash-compare-upload가 개별 호출로 분리되어, 중간에 다른 프로세스가 파일을 수정할 경우 데이터 손실 가능성 (sync-engine.ts:311-360)
4. **복구 불가능한 삭제**: `vault.delete()`를 사용하여 파일이 휴지통 없이 영구 삭제됨 (main.ts:612-619)
5. **캐시 미활용**: `readIfExists`가 `vault.read()`를 래핑하지만 `vault.cachedRead()`를 사용하지 않아 성능 저하 (main.ts:573-585)

## 범위

### 포함 (IN SCOPE)

- `packages/plugin/src/main.ts`: `_startSync()`, `_createVaultAdapter()` 수정
- `packages/plugin/src/sync-engine.ts`: `_uploadLocalFile()`, `_deleteLocalFile()` 수정
- `packages/plugin/tests/`: 각 요구사항에 대한 단위 테스트 추가/수정
- Obsidian 공식 API 메서드로의 전환 (`onLayoutReady`, `fileManager.renameFile`, `vault.process`, `vault.trash`, `vault.cachedRead`)

### 제외 (OUT OF SCOPE - 제외 항목)

- VaultAdapter 인터페이스 자체의 재설계 (인터페이스 시그니처는 유지)
- 서버 측 API 변경 (`packages/server/`)
- Obsidian API 타입 정의 파일 수정 (`packages/plugin/tests/mocks/obsidian.ts`의 타입 추가는 포함)
- 바이너리 파일 처리 로직 재설계
- WebSocket 연결 로직 변경
- UI/설정 탭 변경

## 요구사항

### REQ-API-001: onLayoutReady 래핑 (우선순위: HIGH)

**EARS 패턴**: Event-Driven

**When** 플러그인이 `onload()`에서 동기화를 시작할 때, **the system shall** `app.workspace.onLayoutReady()` 콜백 내에서 vault 이벤트 리스너 등록 및 초기 동기화를 수행한다.

**근거**: Obsidian API 문서에 따르면, vault가 로드되면서 기존 파일에 대한 create 이벤트가 발생한다. `onLayoutReady`는 레이아웃 초기화가 완료된 후에만 콜백을 실행하므로, 이 시점 이후의 파일 변경만 동기화 대상이 된다.

**현재 코드 위치**: `main.ts:113-119` (`_startSync()` 직접 호출)

**트레이서빌리티**: Obsidian API > Workspace.onLayoutReady()

### REQ-API-002: fileManager.renameFile 사용 (우선순위: HIGH)

**EARS 패턴**: Ubiquitous

**The system shall** 파일 이름 변경 시 `vault.rename()` 대신 `app.fileManager.renameFile(file, newPath)`를 사용하여 `[[]]` wiki link가 자동으로 갱신되도록 한다.

**근거**: Obsidian 공식 API에 따르면 `vault.rename()`은 파일 시스템 수준의 이름 변경만 수행하며 다른 노트의 `[[]]` 링크를 갱신하지 않는다. `fileManager.renameFile()`은 링크 메타데이터 업데이트를 포함한 안전한 이름 변경을 수행한다.

**현재 코드 위치**: `sync-engine.ts:_handleMovedEvent()` (646-689번째 줄)에서 `vault.write(toPath) + vault.delete(fromPath)` 패턴 사용

**트레이서빌리티**: Obsidian API > FileManager.renameFile()

### REQ-API-003: vault.process 원자적 연산 (우선순위: MEDIUM)

**EARS 패턴**: Ubiquitous

**The system shall** 파일 읽기-수정-저장 연산에 `vault.process(file, fn)`를 사용하여 read-modify-write가 원자적으로 수행되도록 한다.

**근거**: 현재 `_uploadLocalFile`에서 `readIfExists` -> `computeHash` -> `rawUpload`가 개별 호출로 분리되어 있다. 읽기와 쓰기 사이에 다른 프로세스가 파일을 수정할 경우, 오래된 내용으로 덮어쓰는 데이터 손실이 발생할 수 있다. `vault.process`는 read-modify-write를 원자적 연산으로 보장한다.

**현재 코드 위치**: `sync-engine.ts:311-360` (`_uploadLocalFile`)

**적용 범위**: 로컬 파일 수정 시 해시 비교 및 업로드 로직

**트레이서빌리티**: Obsidian API > Vault.process()

### REQ-API-004: vault.trash로 복구 가능한 삭제 (우선순위: MEDIUM)

**EARS 패턴**: Ubiquitous

**The system shall** 파일 삭제 시 `vault.delete()` 대신 `vault.trash(file, true)`를 사용하여 시스템 휴지통으로 이동시켜 복구 가능하도록 한다.

**근거**: `vault.delete()`는 영구 삭제이며 사용자 실수 시 복구할 수 없다. `vault.trash(file, true)`는 시스템 휴지통으로 이동시켜 사용자가 복구할 수 있도록 한다. Obsidian API에서도 `trash` 사용을 권장한다.

**현재 코드 위치**: `main.ts:612-619` (VaultAdapter.delete), `sync-engine.ts:639-643` (`_deleteLocalFile`)

**트레이서빌리티**: Obsidian API > Vault.trash()

### REQ-API-005: vault.cachedRead 사용 (우선순위: LOW)

**EARS 패턴**: Optional

**Where** 파일 내용이 캐시에 존재하는 경우, **the system shall** `vault.cachedRead(file)`를 우선 사용하여 디스크 I/O를 최소화한다.

**근거**: `vault.cachedRead()`는 Obsidian의 내부 메타데이터 캐시를 활용하므로 `vault.read()`보다 빠르다. 동기화 엔진이 해시 비교를 위해 파일을 반복적으로 읽을 때 성능 향상을 기대할 수 있다.

**현재 코드 위치**: `main.ts:573-585` (VaultAdapter.readIfExists)

**적용 조건**: 캐시된 데이터가 최신임이 보장되는 읽기 전용 컨텍스트 (해시 비교 등)

**트레이서빌리티**: Obsidian API > Vault.cachedRead()

## 제약사항

### 기술적 제약

- Obsidian `vault.process()`는 콜백 내에서 반환된 문자열로 파일을 원자적으로 갱신한다. 현재 VaultAdapter 인터페이스에는 이 메서드가 없으므로, 인터페이스 확장이 필요하다.
- `fileManager.renameFile()`은 `TFile` 인스턴스를 필요로 하므로, `vault.getAbstractFileByPath()`로 파일 객체를 먼저 획득해야 한다.
- `vault.trash()`도 `TFile` 인스턴스가 필요하며, `getAbstractFileByPath`의 반환값을 `TFile`로 타입 가드해야 한다.
- `vault.cachedRead()`는 메타데이터 캐시가 유효한 경우에만 최신 데이터를 보장한다. 외부 변경(서버 다운로드 등) 직후에는 캐시가 무효화되므로 이 경우 `vault.read()`를 사용해야 한다.

### 호환성 제약

- Obsidian 모킹 라이브러리(`tests/mocks/obsidian.ts`, `tests/mocks/vault.ts`)에 새 메서드 stub 추가 필요
- 기존 테스트가 VaultAdapter 인터페이스 확장에 맞게 업데이트되어야 함

### 의존성

| 요구사항 | 선행 작업 |
|----------|-----------|
| REQ-API-001 | 없음 |
| REQ-API-002 | VaultAdapter에 renameFile 메서드 추가 |
| REQ-API-003 | VaultAdapter에 process 메서드 추가 |
| REQ-API-004 | VaultAdapter에 trash 메서드 추가 |
| REQ-API-005 | VaultAdapter에 cachedRead 메서드 추가 |

## 위험

| 위험 | 가능성 | 영향도 | 완화 방안 |
|------|--------|--------|-----------|
| `vault.process` 콜백 내 예외 발생 시 파일 손상 | 낮음 | 높음 | try-catch 래핑, 실패 시 원본 내용 반환 |
| `onLayoutReady`가 호출되지 않는 엣지 케이스 | 낮음 | 중간 | 타임아웃 폴백 (10초 후 강제 시작) |
| `fileManager.renameFile`이 없는 구버전 Obsidian | 낮음 | 중간 | 메서드 존재 여부 확인 후 폴백 |
| `cachedRead`가 오래된 데이터 반환 | 중간 | 낮음 | 해시 비교 실패 시 `read()`로 재시도 |
| 기존 테스트 깨짐 | 높음 | 중간 | 모킹 라이브러리 업데이트를 최우선으로 수행 |
