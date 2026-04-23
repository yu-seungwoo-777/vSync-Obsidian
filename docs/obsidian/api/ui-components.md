# UI 컴포넌트

## Notice

사용자에게 임시 메시지를 표시하는 토스트 알림.

```typescript
new Notice('Hello!');                    // 기본 (5초)
new Notice('Error!', 0);                 // 수동 닫기 (timeout=0)
new Notice('Saved', 3000);              // 3초
```

## Modal

모달 다이얼로그. 커스텀 UI 구현의 기반이 됨.

```typescript
import { App, Modal } from 'obsidian';

class MyModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText('Hello!');
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 열기
const modal = new MyModal(this.app);
modal.open();
```

### Modal 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `contentEl` | `HTMLElement` | 모달 콘텐츠 컨테이너 |
| `containerEl` | `HTMLElement` | 모달 전체 컨테이너 |
| `modalEl` | `HTMLElement` | 모달 엘리먼트 |
| `titleEl` | `HTMLElement` | 타이틀 엘리먼트 |
| `scope` | `Scope` | 키보드 스코프 |

### Modal 메서드

| 메서드 | 설명 |
|--------|------|
| `open()` | 모달 열기 |
| `close()` | 모달 닫기 |
| `onOpen()` | 열릴 때 호출 (오버라이드) |
| `onClose()` | 닫힐 때 호출 (오버라이드) |
| `setTitle(title: string)` | 타이틀 설정 |
| `setContent(content: string)` | 콘텐츠 설정 |

## SuggestModal<T>

검색 가능한 제안 목록 모달.

```typescript
import { App, SuggestModal } from 'obsidian';

class BookModal extends SuggestModal<string> {
    getSuggestions(query: string): string[] {
        return ['Book A', 'Book B', 'Book C'].filter(s =>
            s.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(item: string, el: HTMLElement) {
        el.createEl('div', { text: item });
    }

    onChooseSuggestion(item: string, evt: MouseEvent | KeyboardEvent) {
        new Notice(`Selected: ${item}`);
    }
}
```

### SuggestModal 추상 메서드

| 메서드 | 설명 |
|--------|------|
| `getSuggestions(query: string): T[]` | 쿼리에 맞는 항목 반환 |
| `renderSuggestion(item: T, el: HTMLElement)` | 항목 렌더링 |
| `onChooseSuggestion(item: T, evt: MouseEvent \| KeyboardEvent)` | 항목 선택 시 |

### SuggestModal 오버라이드 가능 메서드

| 메서드 | 설명 |
|--------|------|
| `onNoSuggestion()` | 결과 없을 때 |
| `onOpen()` | 모달 열릴 때 |
| `onClose()` | 모달 닫힐 때 |
| `getEmptyTip()` | 빈 상태 팁 텍스트 |
| `selectSuggestion(item: T, evt: MouseEvent \| KeyboardEvent)` | 항목 선택 로직 |
| `renderSuggestion(item: T, el: HTMLElement)` | 항목 렌더링 |

## FuzzySuggestModal<T>

퍼지 검색이 내장된 제안 모달. `SuggestModal`의 편의 래퍼.

```typescript
import { App, FuzzySuggestModal, Notice } from 'obsidian';

class FuzzyBookModal extends FuzzySuggestModal<string> {
    getItems(): string[] {
        return ['Book A', 'Book B', 'Book C'];
    }

    getItemText(item: string): string {
        return item;
    }

    onChooseItem(item: string, evt: MouseEvent | KeyboardEvent) {
        new Notice(`Selected: ${item}`);
    }
}
```

### FuzzySuggestModal 추상 메서드

| 메서드 | 설명 |
|--------|------|
| `getItems(): T[]` | 전체 항목 목록 |
| `getItemText(item: T): string` | 검색에 사용할 텍스트 |
| `onChooseItem(item: T, evt: MouseEvent \| KeyboardEvent)` | 항목 선택 시 |

## Menu

우클릭 컨텍스트 메뉴.

```typescript
const menu = new Menu();
menu.addItem((item) => {
    item.setTitle('Copy').setIcon('copy').onClick(() => { /* ... */ });
});
menu.addItem((item) => {
    item.setTitle('Delete').setIcon('trash').onClick(() => { /* ... */ });
});
menu.showAtMouseEvent(evt);    // 마우스 이벤트 위치에 표시
menu.showAtPosition({ x: 100, y: 200 }); // 특정 위치에 표시
```

## MenuItem

메뉴의 개별 항목.

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `setTitle(title: string)` | `MenuItem` | 제목 설정 |
| `setIcon(icon: string)` | `MenuItem` | 아이콘 설정 |
| `setDisabled(disabled: boolean)` | `MenuItem` | 비활성화 |
| `setChecked(checked: boolean)` | `MenuItem` | 체크 표시 |
| `setSection(section: string)` | `MenuItem` | 섹션 구분 |
| `onClick(callback: () => any)` | `MenuItem` | 클릭 콜백 |

## PluginSettingTab

플러그인 설정 탭.

```typescript
import { App, PluginSettingTab, Setting } from 'obsidian';

class MySettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Server URL')
            .setDesc('Sync server address')
            .addText(text => text
                .setPlaceholder('https://example.com')
                .setValue(this.plugin.settings.server_url)
                .onChange(async (value) => {
                    this.plugin.settings.server_url = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}
```

## Setting

설정 UI 빌더. 체이닝 지원.

```typescript
new Setting(containerEl)
    .setName('Name')
    .setDesc('Description')
    .addText(text => text
        .setPlaceholder('Placeholder')
        .setValue('current value')
        .onChange(async (value) => { /* ... */ })
    );
```

### Setting 컨트롤 추가 메서드

| 메서드 | 설명 |
|--------|------|
| `addText(cb)` | 텍스트 입력 |
| `addTextArea(cb)` | 여러 줄 텍스트 |
| `addToggle(cb)` | 토글 스위치 |
| `addDropdown(cb)` | 드롭다운 선택 |
| `addSlider(cb)` | 슬라이더 |
| `addButton(cb)` | 버튼 |
| `addColorPicker(cb)` | 색상 선택 |
| `addMomentFormat(cb)` | 날짜/시간 포맷 |
| `addSearch(cb)` | 검색 입력 |
| `addExtraButton(cb)` | 추가 버튼 |
| `setClass(cls)` | CSS 클래스 |
| `setHeading()` | 헤딩 스타일 |
| `setDisabled(disabled)` | 비활성화 |

## requestUrl

HTTP 요청 유틸리티. Node.js 환경 제약 없이 사용 가능.

```typescript
import { requestUrl } from 'obsidian';

const response = await requestUrl({
    url: 'https://api.example.com/data',
    method: 'GET',
    headers: { 'Authorization': 'Bearer token' },
});

console.log(response.json);
console.log(response.text);
console.log(response.status);
```

### RequestUrlResponse

| 속성 | 타입 | 설명 |
|------|------|------|
| `status` | `number` | HTTP 상태 코드 |
| `headers` | `Record<string, string>` | 응답 헤더 |
| `text` | `string` | 응답 본문 (텍스트) |
| `json` | `any` | 응답 본문 (JSON 파싱) |
| `arrayBuffer` | `ArrayBuffer` | 응답 본문 (바이너리) |

## FileManager

파일 관리 유틸리티. `app.fileManager`로 접근.

### `renameFile(file: TAbstractFile, newPath: string): Promise<void>`

파일 이름 변경. **링크를 자동으로 갱신** (Vault.rename()과의 차이점).

```typescript
await this.app.fileManager.renameFile(file, 'new-path.md');
// 기존 파일을 참조하는 모든 링크가 자동으로 업데이트됨
```

### `generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string): string`

마크다운 링크 문자열 생성.

```typescript
const link = this.app.fileManager.generateMarkdownLink(
    targetFile,
    'current-note.md',
    '#heading',
    'Display Text'
);
// [[target-note#heading|Display Text]]
```
