---
id: SPEC-WORKSPACE-ADAPTER-001
version: 1.0.0
status: completed
created: "2026-04-21"
updated: "2026-04-21"
author: manager-spec
priority: high
issue_number: null
---

# WorkspaceAdapter 인터페이스 도입

## 배경

VSync 플러그인은 VaultAdapter 인터페이스(`sync-engine.ts:996-1014`)를 통해 모든 Vault 파일 I/O를 추상화한다. 그러나 main.ts의 여러 위치에서 `this.app.workspace.*` 및 관련 UI API를 직접 호출하고 있어, 테스트 격리와 API 교체 가능성이 제한된다.

### 현재 직접 호출 지점 (5곳)

| 위치 | 호출 | 용도 |
|------|------|------|
| `main.ts:115` | `this.app.workspace.onLayoutReady(cb)` | onload 시 초기화 지연 |
| `main.ts:149` | `this.app.workspace.getLeavesOfType(viewType)` | 로그 뷰 리프 탐색 |
| `main.ts:153` | `(this.app.workspace as any).getRightLeaf(false)` | 오른쪽 사이드바 리프 확보 |
| `main.ts:432` | `this.app.workspace.getLeavesOfType(viewType)` | 충돌 뷰 리프 탐색 |
| `main.ts:438` | `(this.app.workspace as any).getRightLeaf(false)` | 오른쪽 사이드바 리프 확보 |
| `main.ts:487` | `this.app.vault.getAbstractFileByPath(path)` | 검색 결과 파일 조회 |
| `main.ts:490` | `(this.app.workspace as any).getLeaf(false)?.openFile(file)` | 파일 열기 |

## 요구사항

### REQ-WA-001: WorkspaceAdapter 인터페이스 정의

**While** 플러그인이 Obsidian Workspace API와 상호작용할 때, **the system shall** 모든 workspace/UI 호출을 WorkspaceAdapter 인터페이스를 통해서만 수행한다.

인터페이스 메서드:

```typescript
export interface WorkspaceAdapter {
  onLayoutReady(callback: () => void): void;
  openFile(filePath: string): Promise<void>;
  getLeavesOfType(viewType: string): Array<{ detach: () => void }>;
  openViewInRightLeaf(viewType: string): Promise<void>;
}
```

### REQ-WA-002: onLayoutReady 추상화

**When** `onload()`에서 `onLayoutReady` 콜백을 등록할 때, **the system shall** `WorkspaceAdapter.onLayoutReady()`를 통해 호출한다.

- 추적: `main.ts:115` 대체

### REQ-WA-003: getLeavesOfType 추상화

**When** 활성 뷰의 리프를 탐색할 때, **the system shall** `WorkspaceAdapter.getLeavesOfType(viewType)`을 통해 호출한다.

- 추적: `main.ts:149`, `main.ts:432` 대체
- 반환 타입은 Obsidian WorkspaceLeaf의 최소 인터페이스인 `Array<{ detach: () => void }>`로 제한

### REQ-WA-004: openViewInRightLeaf 추상화

**When** 오른쪽 사이드바에 뷰를 열 때, **the system shall** `WorkspaceAdapter.openViewInRightLeaf(viewType)`을 통해 호출한다.

- 추적: `main.ts:153-159`, `main.ts:438-444` 대체
- 내부적으로 `(workspace as any).getRightLeaf(false)` + `setViewState` 를 캡슐화

### REQ-WA-005: openFile 추상화

**When** 검색 결과에서 파일을 열 때, **the system shall** `WorkspaceAdapter.openFile(filePath)`를 통해 호출한다.

- 추적: `main.ts:487-490` 대체
- `getAbstractFileByPath` + `getLeaf(false)?.openFile` 조합을 단일 메서드로 캡슐화

### REQ-WA-006: 모든 직접 호출 제거

**If** main.ts에 `this.app.workspace.*` 직접 호출이 존재하면, **then** 해당 호출은 WorkspaceAdapter로 리팩터링되어야 한다.

- 예외: `registerView`, `addRibbonIcon` 등 Plugin 기반 등록 메서드는 제외

### REQ-WA-007: 테스트 모킹

**Where** WorkspaceAdapter가 사용되는 곳에서, **the system shall** 테스트에서 WorkspaceAdapter를 모킹하여 Obsidian API 의존성을 완전히 격리할 수 있어야 한다.

## 제약사항

- VaultAdapter 패턴과 일관된 구조 유지
- `_createVaultAdapter()`와 동일한 방식으로 `_createWorkspaceAdapter()` 팩토리 메서드 사용
- 기존 기능 동작 변경 없음 (순수 리팩터링)

## 제외 항목 (What NOT to Build)

- WorkspaceAdapter에 상태 표시줄(status bar) 관련 기능 포함하지 않음 (이미 Plugin API로 충분히 추상화됨)
- `registerView`, `addRibbonIcon`, `addCommand` 등 Plugin 생명주기 메서드는 추상화하지 않음
- SyncEngine 내부에서의 workspace 호출은 범위 밖 (SyncEngine은 VaultAdapter만 사용)
- WorkspaceAdapter를 별도 파일로 분리하지 않음 (VaultAdapter가 sync-engine.ts에 정의된 것과 달리, WorkspaceAdapter는 main.ts에 정의 — 사용처가 main.ts뿐이므로)

## 히스토리

| 날짜 | 버전 | 변경 내용 |
|------|------|-----------|
| 2026-04-21 | 1.0.0 | 최초 작성 |

## 관련 SPEC

- SPEC-P6-RELIABLE-005: VaultAdapter 패턴 (참조 모델)
- SPEC-OBSIDIAN-API-GAP-001: Obsidian API 래핑 패턴
- SPEC-P6-UX-002: 충돌 해결 UX (activateConflictView 영향)
