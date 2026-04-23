# Workspace API

워크스페이스는 Obsidian의 뷰, 탭, 레이아웃을 관리하는 핵심 API입니다.

## Workspace 클래스

```typescript
export class Workspace extends Events
```

## 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `activeLeaf` | `WorkspaceLeaf \| null` | 현재 활성 리프 |
| `activeEditor` | `MarkdownView \| null` | 현재 활성 에디터 |
| `leftRibbon` | `WorkspaceRibbon` | 왼쪽 리본 |
| `rightRibbon` | `WorkspaceRibbon` | 오른쪽 리본 |
| `leftSplit` | `WorkspaceSidedock` | 왼쪽 사이드바 |
| `rightSplit` | `WorkspaceSidedock` | 오른쪽 사이드바 |
| `rootSplit` | `WorkspaceRoot` | 메인 영역 스플릿 |

## 리프 관리

### `getLeavesOfType(viewType: string): WorkspaceLeaf[]`

특정 뷰 타입의 모든 리프 반환.

```typescript
const leaves = workspace.getLeavesOfType('markdown');
```

### `iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void`

모든 리프 순회 (메인, 사이드바, 플로팅 포함).

### `getLeaf(newLeaf?: boolean): WorkspaceLeaf`

새 리프 가져오기. `newLeaf=true`면 새 탭으로 열기.

### `getLeaf(newLeaf, location): WorkspaceLeaf` (0.16.0+)

위치 지정 가능.

```typescript
const leaf = workspace.getLeaf(true, 'tab');     // 새 탭
const leaf = workspace.getLeaf(true, 'split');   // 분할
const leaf = workspace.getLeaf(true, 'window');  // 새 창
```

### `getActiveViewOfType<T>(type: Constructor<T>): T | null`

현재 활성 뷰를 특정 타입으로 조회.

```typescript
const view = workspace.getActiveViewOfType(MarkdownView);
```

## 파일 열기

### `openLinkText(linktext: string, sourcePath: string, newLeaf?: boolean, openViewState?: OpenViewState): Promise<void>`

링크 텍스트로 파일 열기.

### `openFile(file: TFile, openState?: OpenViewState, match?: (leaf: WorkspaceLeaf) => boolean): Promise<void>` (내부)

## 레이아웃

### `onLayoutReady(callback: () => void): void`

레이아웃 초기화 완료 후 콜백 실행. **Vault `create` 이벤트의 중복 발생을 피하려면 이 안에서 구독**.

```typescript
this.app.workspace.onLayoutReady(() => {
    this.registerEvent(
        this.app.vault.on('create', (file) => {
            // 볼트 로드 시 기존 파일에 대한 create 이벤트 제외
        })
    );
});
```

## 이벤트

### `file-open`

파일이 열렸을 때.

```typescript
on(name: 'file-open', callback: (file: TFile | null) => any, ctx?: any): EventRef;
```

### `active-leaf-change`

활성 리프가 변경되었을 때.

```typescript
on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => any, ctx?: any): EventRef;
```

### `layout-change`

워크스페이스 레이아웃이 변경되었을 때.

### `resize`

워크스페이스 크기가 변경되었을 때.

### `css-change`

CSS 테마가 변경되었을 때.

---

# WorkspaceLeaf

워크스페이스의 단일 탭/패널을 나타냄.

```typescript
export class WorkspaceLeaf extends WorkspaceItem implements HoverParent
```

## 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `view` | `View` | 리프에 연결된 뷰 |
| `isDeferred` | `boolean` | 백그라운드로 지연 로드된 상태인지 (1.7.2+) |
| `parent` | `WorkspaceTabs \| WorkspaceMobileDrawer` | 부모 컨테이너 |
| `hoverPopover` | `HoverPopover \| null` | 호버 팝오버 |
| `tabHeader` | `HTMLElement` | 탭 헤더 엘리먼트 |
| `pinned` | `boolean` | 고정 여부 |

## 메서드

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `open(view: View)` | `Promise<void>` | 뷰 열기 |
| `openFile(file: TFile, openState?)` | `Promise<void>` | 파일 열기 |
| `setViewState(vs: ViewState, eState?)` | `Promise<void>` | 뷰 상태 설정 |
| `getViewState()` | `ViewState` | 현재 뷰 상태 조회 |
| `getEphemeralState()` | `any` | 임시 상태 조회 (스크롤 위치 등) |
| `setEphemeralState(state)` | `void` | 임시 상태 설정 |
| `getDisplayText()` | `string` | 표시 텍스트 |
| `getIcon()` | `string` | 아이콘 이름 |
| `setPinned(pinned: boolean)` | `void` | 고정 설정 |
| `togglePinned()` | `void` | 고정 토글 |
| `detach()` | `void` | 리프 제거 |
| `loadIfDeferred()` | `Promise<void>` | 지연된 뷰 로드 (1.7.2+) |
| `onResize()` | `void` | 리사이즈 알림 |
| `getContainer()` | `WorkspaceItem` | 루트 컨테이너 |
| `getRoot()` | `WorkspaceRoot` | 워크스페이스 루트 |
| `setGroup(group: string)` | `void` | 그룹 설정 |
| `setGroupMember(other: WorkspaceLeaf)` | `void` | 다른 리프와 그룹 멤버 설정 |

## 이벤트

| 이벤트 | 콜백 | 설명 |
|--------|------|------|
| `pinned-change` | `() => any` | 고정 상태 변경 시 |
| `group-change` | `(group: string) => any` | 그룹 변경 시 |
