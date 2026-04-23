# Editor API

에디터 텍스트 조작 API. `editorCallback: (editor: Editor, view: MarkdownView) => void` 형태로 사용.

## 내용 읽기

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `getValue()` | `string` | 전체 내용 반환 |
| `getLine(n: number)` | `string` | n번째 줄 텍스트 (0-indexed) |
| `getRange(from: EditorPosition, to: EditorPosition)` | `string` | 범위 내 텍스트 |
| `getSelection()` | `string` | 현재 선택 영역 텍스트 |
| `lineCount()` | `number` | 전체 줄 수 |
| `lastLine()` | `number` | 마지막 줄 인덱스 |
| `firstLine()` | `number` | 첫 줄 인덱스 (항상 0) |

## 내용 쓰기

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `setValue(content: string)` | `void` | 전체 내용 교체 |
| `setLine(n: number, text: string)` | `void` | n번째 줄 교체 |
| `replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition, origin?: string)` | `void` | 범위 교체 |
| `replaceSelection(replacement: string, origin?: string)` | `void` | 선택 영역 교체 |
| `transaction(tx: EditorTransaction, origin?: string)` | `void` | 원자적 트랜잭션 실행 (0.13.0+) |

## 커서/선택

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `getCursor(side?: 'from' \| 'to' \| 'head' \| 'anchor')` | `EditorPosition` | 커서 위치 |
| `setCursor(pos: EditorPosition \| number, ch?: number)` | `void` | 커서 위치 설정 |
| `setSelection(anchor: EditorPosition, head: EditorPosition)` | `void` | 선택 영역 설정 |
| `somethingSelected()` | `boolean` | 선택 영역 존재 여부 |

## 포맷 변환

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `posToOffset(pos: EditorPosition)` | `number` | 위치 → 문자 오프셋 |
| `offsetToPos(offset: number)` | `EditorPosition` | 문자 오프셋 → 위치 |

## 스크롤

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `getScrollInfo()` | `{ left, top, width, height, clientWidth, clientHeight }` | 스크롤 정보 |
| `scrollTo(x: number, y: number)` | `void` | 스크롤 이동 |
| `scrollIntoView(range: EditorRange, center?: boolean)` | `void` | 범위가 보이도록 스크롤 |

## 포커스

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `focus()` | `void` | 에디터에 포커스 |
| `blur()` | `void` | 에디터 포커스 해제 |
| `hasFocus()` | `boolean` | 포커스 여부 |

## 실행 취소/재실행

| 메서드 | 반환값 | 설명 |
|--------|--------|------|
| `undo()` | `void` | 실행 취소 |
| `redo()` | `void` | 재실행 |
| `exec(command: string)` | `void` | 에디터 명령 실행 |

## 사용 예시

### 커서 위치에 텍스트 삽입

```typescript
this.addCommand({
    id: 'insert-timestamp',
    name: 'Insert timestamp',
    editorCallback: (editor) => {
        const timestamp = new Date().toLocaleString();
        editor.replaceRange(timestamp, editor.getCursor());
    },
});
```

### 선택 텍스트 대문자 변환

```typescript
this.addCommand({
    id: 'to-uppercase',
    name: 'Convert to uppercase',
    editorCallback: (editor) => {
        const selection = editor.getSelection();
        editor.replaceSelection(selection.toUpperCase());
    },
});
```

### 원자적 트랜잭션

```typescript
editor.transaction({
    changes: [
        { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 }, text: 'Hello' },
        { from: { line: 1, ch: 0 }, to: { line: 1, ch: 5 }, text: 'World' },
    ],
    selection: { anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 5 } },
    scrollIntoView: true,
});
```

### 파일 전체 내용 읽기/수정

```typescript
editorCallback: (editor) => {
    const content = editor.getValue();
    const modified = content.replace(/old/g, 'new');
    editor.setValue(modified);
};
```
