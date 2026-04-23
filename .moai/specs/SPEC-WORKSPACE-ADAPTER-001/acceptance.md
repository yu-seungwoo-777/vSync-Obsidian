---
spec_id: SPEC-WORKSPACE-ADAPTER-001
version: 1.0.0
status: planned
created: "2026-04-21"
updated: "2026-04-21"
---

# 인수 기준: WorkspaceAdapter 인터페이스 도입

## AC-001: WorkspaceAdapter 인터페이스 정의

**Given** main.ts 소스 코드에
**When** WorkspaceAdapter 인터페이스를 정의하면
**Then** 다음 메서드가 포함되어야 한다:
- `onLayoutReady(callback: () => void): void`
- `openFile(filePath: string): Promise<void>`
- `getLeavesOfType(viewType: string): Array<{ detach: () => void }>`
- `openViewInRightLeaf(viewType: string): Promise<void>`

## AC-002: 팩토리 메서드 존재

**Given** VSyncPlugin 클래스에
**When** `_createWorkspaceAdapter()` 메서드가 존재하면
**Then** WorkspaceAdapter 인터페이스를 구현한 객체를 반환해야 한다.

## AC-003: onLayoutReady 추상화 (REQ-WA-002)

**Given** `onload()`에서 `onLayoutReady`를 호출할 때
**When** 설정이 구성된 경우
**Then** `this.app.workspace.onLayoutReady`를 직접 호출하지 않고 `_workspaceAdapter.onLayoutReady`를 호출해야 한다.

**검증**: `main.ts`에서 `this.app.workspace.onLayoutReady` 문자열 검색 결과가 0건.

## AC-004: getLeavesOfType 추상화 (REQ-WA-003)

**Given** `_activateLogView()` 또는 `activateConflictView()`에서
**When** 리프를 탐색할 때
**Then** `_workspaceAdapter.getLeavesOfType(viewType)`을 호출해야 한다.

**검증**: `main.ts`에서 `this.app.workspace.getLeavesOfType` 문자열 검색 결과가 0건.

## AC-005: openViewInRightLeaf 추상화 (REQ-WA-004)

**Given** `_activateLogView()` 또는 `activateConflictView()`에서
**When** 오른쪽 사이드바에 뷰를 열 때
**Then** `_workspaceAdapter.openViewInRightLeaf(viewType)`을 호출해야 한다.

**검증**: `main.ts`에서 `getRightLeaf` 문자열 검색 결과가 0건.

## AC-006: openFile 추상화 (REQ-WA-005)

**Given** `_openFileFromSearch()`에서
**When** 파일을 열 때
**Then** `_workspaceAdapter.openFile(filePath)`를 호출해야 한다.

**검증**: `main.test.ts`에서 `_workspaceAdapter.openFile` 호출 확인.

## AC-007: 직접 호출 완전 제거 (REQ-WA-006)

**Given** main.ts 전체 코드에
**When** `this.app.workspace` 패턴을 검색하면
**Then** `_createWorkspaceAdapter()` 내부를 제외하고 결과가 0건이어야 한다.

**예외**: `this.app.workspace`는 `_createWorkspaceAdapter()` 클로저 내부에서만 캡처됨.

## AC-008: 테스트 모킹 (REQ-WA-007)

### AC-008.1: WorkspaceAdapter 모킹

**Given** 테스트 환경에서
**When** VSyncPlugin을 인스턴스화하면
**Then** `_createWorkspaceAdapter()`가 호출되어 어댑터가 생성되어야 한다.

### AC-008.2: onLayoutReady 모킹

**Given** 모킹된 WorkspaceAdapter에서
**When** `onLayoutReady` 호출 시
**Then** 콜백이 즉시 실행되거나 지정된 대로 동작해야 한다.

### AC-008.3: openFile 모킹

**Given** 모킹된 WorkspaceAdapter에서
**When** `openFile('test.md')` 호출 시
**Then** `getAbstractFileByPath` + `getLeaf` + `openFile` 체인이 올바르게 실행되어야 한다.

### AC-008.4: 기존 테스트 통과

**Given** 기존 테스트 스위트에
**When** 모든 테스트를 실행하면
**Then** 기존 테스트가 모두 통과해야 한다 (기능 회귀 없음).

## 에지 케이스

### EC-001: getRightLeaf 미지원

**Given** Obsidian 환경에서 `getRightLeaf`를 사용할 수 없는 경우
**When** `openViewInRightLeaf` 호출 시
**Then** null 체크로 안전하게 무시되어야 한다 (에러 발생하지 않음).

### EC-002: openFile로 존재하지 않는 파일 열기

**Given** 파일 경로가 vault에 존재하지 않을 때
**When** `openFile` 호출 시
**Then** Notice로 파일을 찾을 수 없다는 메시지를 표시해야 한다.

### EC-003: getLeavesOfType 빈 결과

**Given** 지정한 viewType의 리프가 없을 때
**When** `getLeavesOfType` 호출 시
**Then** 빈 배열을 반환하고 `openViewInRightLeaf`로 새 리프를 열어야 한다.

## 품질 게이트

- [ ] 모든 기존 테스트 통과
- [ ] `this.app.workspace` 직접 호출 제거 확인 (Grep 검증)
- [ ] TypeScript 컴파일 에러 없음
- [ ] ESLint 에러 없음
- [ ] 기능 동작 변경 없음 (순수 리팩터링)

## 완료 기준 (Definition of Done)

1. WorkspaceAdapter 인터페이스가 main.ts에 정의됨
2. `_createWorkspaceAdapter()` 팩토리 메서드가 구현됨
3. main.ts의 모든 `this.app.workspace.*` 직접 호출이 어댑터로 교체됨
4. `_openFileFromSearch`의 `this.app.vault.getAbstractFileByPath` + openFile이 어댑터로 교체됨
5. 테스트 모킹이 업데이트됨
6. 모든 기존 테스트가 통과함
7. 새로운 어댑터 경로에 대한 테스트가 추가됨
