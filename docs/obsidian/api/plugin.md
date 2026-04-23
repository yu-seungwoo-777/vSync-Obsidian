# Plugin 클래스

모든 Obsidian 플러그인의 기본 클래스. `Component`를 상속합니다.

```typescript
abstract class Plugin extends Component
```

## 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `app` | `App` | Obsidian 앱 인스턴스 |
| `manifest` | `PluginManifest` | 플러그인 매니페스트 |

## 라이프사이클

### `onload(): Promise<void>`

플러그인 로드 시 호출. 명령, 이벤트, 설정 등을 등록하는 곳.

### `onunload(): void`

플러그인 언로드 시 호출. 리소스 정리.

## 데이터 관리

### `loadData(): Promise<any>`

`data.json`에서 설정 데이터 로드.

### `saveData(data: any): Promise<void>`

`data.json`에 설정 데이터 저장.

```typescript
async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
}

async saveSettings() {
    await this.saveData(this.settings);
}
```

## UI 등록

### `addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement`

리본에 아이콘 추가. 반환된 `HTMLElement`로 조작 가능.

```typescript
this.addRibbonIcon('dice', 'My Plugin', (evt) => {
    new Notice('Clicked!');
});
```

### `addStatusBarItem(): HTMLElement`

상태 표시줄에 항목 추가. 반환된 엘리먼트에 직접 조작.

```typescript
const statusBarItem = this.addStatusBarItem();
statusBarItem.setText('Ready');
```

### `addSettingTab(settingTab: PluginSettingTab): void`

설정 탭 추가.

### `addCommand(command: Command): void`

명령 팔레트에 명령 추가.

```typescript
this.addCommand({
    id: 'my-command',
    name: 'My Command',
    callback: () => { /* 전역 명령 */ },
});

this.addCommand({
    id: 'editor-command',
    name: 'Editor Command',
    editorCallback: (editor, view) => { /* 에디터 명령 */ },
});

this.addCommand({
    id: 'check-command',
    name: 'Check Command',
    checkCallback: (checking) => { /* 조건부 명령 */ },
});
```

## 이벤트/타이머 등록

### `registerEvent(eventRef: EventRef): void`

이벤트 리스너 등록. **플러그인 언로드 시 자동 해제**.

```typescript
this.registerEvent(
    this.app.vault.on('create', (file) => {
        console.log('Created:', file.path);
    })
);
```

### `registerInterval(id: number): void`

인터벌 등록. 플러그인 언로드 시 자동 해제.

```typescript
this.registerInterval(
    window.setInterval(() => this.updateTimer(), 1000)
);
```

### `registerDomEvent(element: HTMLElement, eventType: string, callback: (evt: Event) => void): void`

DOM 이벤트 등록. 플러그인 언로드 시 자동 해제.

```typescript
this.registerDomEvent(document, 'click', (evt) => {
    console.log('click', evt);
});
```

## 에디터 확장

### `registerEditorExtension(extension: Extension[]): void`

CodeMirror 6 확장 등록.

```typescript
this.registerEditorExtension([myPlugin, myField]);
```

## 마크다운 처리

### `registerMarkdownCodeBlockProcessor(language: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void): void`

커스텀 코드 블록 프로세서 등록.

```typescript
this.registerMarkdownCodeBlockProcessor('myblock', (source, el) => {
    el.createEl('pre', { text: source.toUpperCase() });
});
```

### `registerMarkdownPostProcessor(handler: (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void): void`

마크다운 후처리기 등록.

## 뷰 등록

### `registerView(viewType: string, viewCreator: (leaf: WorkspaceLeaf) => View): void`

커스텀 뷰 타입 등록.

```typescript
this.registerView(MY_VIEW_TYPE, (leaf) => new MyView(leaf));
```

## 하위 컴포넌트

### `addChild(component: Component): void`

하위 컴포넌트 추가. 부모 로드 시 함께 로드.

---

# Command 인터페이스

```typescript
interface Command {
    id: string;
    name: string;
    icon?: string;
    hotkeys?: Hotkey[];
    callback?: () => void;
    editorCallback?: (editor: Editor, view: MarkdownView) => void;
    checkCallback?: (checking: boolean) => boolean | void;
    editorCheckCallback?: (checking: boolean, editor: Editor, view: MarkdownView) => boolean | void;
    mobileOnly?: boolean;
    desktopOnly?: boolean;
}
```

- `checking=true`: 명령이 활성화된지만 확인 (UI 표시용)
- `checking=false`: 실제 명령 실행
- `checkCallback`에서 `false` 반환하면 명령 비활성화
