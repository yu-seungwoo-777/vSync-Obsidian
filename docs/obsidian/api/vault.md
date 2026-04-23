# Vault API

Vault 클래스는 Obsidian 볼트 내의 파일과 폴더를 조작하는 핵심 API입니다. `Events` 클래스를 상속합니다.

```typescript
export class Vault extends Events
```

## 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `adapter` | `DataAdapter` | 볼트 파일 어댑터 |
| `configDir` | `string` | 설정 폴더 경로 (기본 `.obsidian`) (0.11.1+) |

## 파일 읽기

### `read(file: TFile): Promise<string>`

디스크에서 직접 읽기. 파일 수정 목적일 때 사용.

```typescript
const content = await vault.read(file);
```

### `cachedRead(file: TFile): Promise<string>`

캐시된 내용 읽기. 화면 표시 목적일 때 사용. 성능이 더 좋음.

### `readBinary(file: TFile): Promise<ArrayBuffer>`

바이너리 파일 읽기.

## 파일 쓰기

### `create(path: string, data?: string, options?): Promise<TFile>`

새 텍스트 파일 생성.

```typescript
const newFile = await vault.create('notes/new-note.md', '# New Note');
```

### `createBinary(path: string, data: ArrayBuffer, options?): Promise<TFile>`

새 바이너리 파일 생성.

### `modify(file: TFile, data: string, options?): Promise<void>`

텍스트 파일 내용 수정.

### `modifyBinary(file: TFile, data: ArrayBuffer, options?): Promise<void>`

바이너리 파일 내용 수정.

### `append(file: TFile, data: string, options?): Promise<void>`

텍스트 파일 끝에 내용 추가.

### `appendBinary(file: TFile, data: ArrayBuffer, options?): Promise<void>`

바이너리 파일 끝에 데이터 추가.

### `process(file: TFile, fn: (data: string) => string, options?): Promise<string>`

원자적으로 읽기-수정-저장. 데이터 손실 방지에 적합.

```typescript
await vault.process(file, (data) => data.replace('old', 'new'));
```

## 파일 조작

### `rename(file: TAbstractFile, newPath: string): Promise<void>`

파일 이름 변경/이동. **링크 자동 갱신이 안 됨** → 링크 갱신이 필요하면 `FileManager.renameFile()` 사용.

### `copy(file: TAbstractFile, newPath: string): Promise<void>`

파일/폴더 복사.

### `trash(file: TAbstractFile, system: boolean): Promise<void>`

휴지통으로 이동. `system=true`면 시스템 휴지통, 실패하면 로컬 휴지통.

### `delete(file: TAbstractFile, force?: boolean): Promise<void>`

완전 삭제 (휴지통 거치지 않음).

## 파일 조회

### `getAbstractFileByPath(path: string): TAbstractFile | null`

경로로 파일/폴더 조회. `instanceof TFile` / `instanceof TFolder`로 타입 확인.

### `getFileByPath(path: string): TFile | null`

경로로 파일만 조회. 폴더면 `null`.

### `getFolderByPath(path: string): TFolder | null`

경로로 폴더만 조회.

### `getFiles(): TFile[]`

볼트 내 모든 파일 반환.

### `getMarkdownFiles(): TFile[]`

볼트 내 모든 마크다운 파일만 반환.

### `getAllLoadedFiles(): TAbstractFile[]`

로드된 모든 파일과 폴더 반환.

### `getAllFolders(includeRoot?: boolean): TFolder[]`

모든 폴더 반환.

### `getRoot(): TFolder`

볼트 루트 폴더 반환.

### `getName(): string`

볼트 이름 반환.

### `getResourcePath(file: TFile): string`

브라우저에서 사용할 리소스 URI 반환 (이미지 삽입 등).

## 폴더 조작

### `createFolder(path: string): Promise<void>`

새 폴더 생성.

## 정적 메서드

### `Vault.recurseChildren(root: TFolder, cb: (file: TAbstractFile) => any): void`

폴더 하위의 모든 파일/폴더를 재귀적으로 순회.

```typescript
Vault.recurseChildren(vault.getRoot(), (file) => {
    console.log(file.path);
});
```

## 이벤트

`vault.on(name, callback, ctx?)` 형태로 이벤트 구독. `EventRef` 반환.

### `create`

파일 생성 시 발생. **볼트 로드 시 기존 파일에도 발생**하므로, 로드 시 이벤트를 원치 않으면 `Workspace.onLayoutReady()` 안에서 구독.

```typescript
on(name: 'create', callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
```

### `modify`

파일 내용 수정 시 발생.

```typescript
on(name: 'modify', callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
```

### `delete`

파일 삭제 시 발생.

```typescript
on(name: 'delete', callback: (file: TAbstractFile) => any, ctx?: any): EventRef;
```

### `rename`

파일 이름 변경 시 발생. **`file.path`(새 경로)와 `oldPath`(이전 경로)를 함께 제공**.

```typescript
on(name: 'rename', callback: (file: TAbstractFile, oldPath: string) => any, ctx?: any): EventRef;
```

```typescript
vault.on('rename', (file, oldPath) => {
    console.log(`Renamed: ${oldPath} → ${file.path}`);
});
```

### 이벤트 구독 패턴

`registerEvent()`로 구독하면 플러그인 언로드 시 자동 해제됨.

```typescript
// Plugin 내부에서
this.registerEvent(
    this.app.vault.on('rename', (file, oldPath) => {
        // 처리
    })
);
```

Vault 어댑터 패턴에서는 `on`/`off`를 직접 사용:

```typescript
const ref = vault.on('rename', handler);
// 나중에
vault.offref(ref);
```
