# 핵심 타입

## TAbstractFile

파일과 폴더의 공통 기본 클래스.

```typescript
export abstract class TAbstractFile {
    vault: Vault;
    path: string;       // 볼트 내 상대 경로
    name: string;       // 파일/폴더 이름 (확장자 포함)
    parent: TFolder;    // 부모 폴더. 루트면 null
}
```

## TFile (extends TAbstractFile)

파일을 나타내는 클래스.

```typescript
export class TFile extends TAbstractFile {
    stat: {
        ctime: number;  // 생성 시간 (ms)
        mtime: number;  // 수정 시간 (ms)
        size: number;   // 파일 크기 (bytes)
    };
    basename: string;   // 확장자 제외한 파일명
    extension: string;  // 확장자 ('md', 'png' 등)
}
```

### TFile 주요 속성 예시

```
파일 경로: "notes/project-plan.md"
├── path:      "notes/project-plan.md"
├── name:      "project-plan.md"
├── basename:  "project-plan"
├── extension: "md"
├── parent:    TFolder { path: "notes" }
└── stat:      { ctime: 1713720000000, mtime: 1713806400000, size: 2048 }
```

## TFolder (extends TAbstractFile)

폴더를 나타내는 클래스.

```typescript
export class TFolder extends TAbstractFile {
    children: TAbstractFile[];  // 직계 자식 (파일+폴더)
    isRoot(): boolean;          // 루트 폴더인지 확인
}
```

## EditorPosition

에디터 내 위치 (줄/문자).

```typescript
interface EditorPosition {
    line: number;   // 0-indexed 줄 번호
    ch: number;     // 줄 내 문자 오프셋 (0-indexed)
}
```

## EditorRange

에디터 내 텍스트 범위.

```typescript
interface EditorRange {
    from: EditorPosition;
    to: EditorPosition;
}
```

## EditorRangeOrCaret

범위 또는 캐럿(단일 위치).

```typescript
type EditorRangeOrCaret = EditorRange | { from: EditorPosition; to?: undefined };
```

## EditorSelection

선택 영역 + 방향.

```typescript
interface EditorSelection {
    anchor: EditorPosition;  // 선택 시작점
    head: EditorPosition;    // 선택 끝점 (커서 위치)
}
```

## EditorChange

단일 편집 변경.

```typescript
interface EditorChange extends EditorRange {
    text: string;     // 교체할 텍스트
    origin?: string;  // 변경 출처
}
```

## EditorTransaction

원자적 편집 트랜잭션.

```typescript
interface EditorTransaction {
    changes?: EditorChange[];
    selection?: { anchor: EditorPosition; head: EditorPosition };
    scrollIntoView?: boolean;
}
```

## ViewState

뷰 상태 객체.

```typescript
interface ViewState {
    type: string;         // 뷰 타입 ('markdown', 'canvas' 등)
    state?: Record<string, unknown>;  // 뷰별 상태
    active?: boolean;     // 활성 상태 여부
    pinned?: boolean;     // 고정 여부
    group?: WorkspaceLeaf; // 그룹
}
```

## OpenViewState

파일 열기 옵션.

```typescript
interface OpenViewState {
    state?: Record<string, unknown>;  // 초기 뷰 상태
    eState?: Record<string, unknown>; // 임시 상태 (스크롤 위치 등)
    active?: boolean;                 // 활성화 여부
    group?: WorkspaceLeaf;            // 그룹
}
```

## CachedMetadata

파일 메타데이터 캐시.

```typescript
interface CachedMetadata {
    frontmatter?: FrontMatterInfo;         // YAML 프론트매터
    frontmatterLinks?: LinkCache[];        // 프론트매터 내 링크
    headings?: HeadingCache[];             // 헤딩 목록
    links?: LinkCache[];                   // 내부 링크
    embeds?: EmbedCache[];                 // 임베드 (![[...]])
    tags?: TagCache[];                     // 태그
    sections?: SectionCache[];             // 섹션
    blocks?: Record<string, BlockCache>;   // 블록 참조
}
```

## PluginManifest

플러그인 매니페스트.

```typescript
interface PluginManifest {
    id: string;              // 플러그인 고유 ID
    name: string;            // 표시 이름
    version: string;         // 시맨틱 버전
    minAppVersion: string;   // 최소 Obsidian 버전
    maxAppVersion?: string;  // 최대 Obsidian 버전
    description: string;     // 설명
    author: string;          // 작성자
    authorUrl?: string;      // 작성자 URL
    isDesktopOnly?: boolean; // 데스크톱 전용 여부
}
```

## EventRef

이벤트 리스너 참조. `offref()`로 해제할 때 사용.

```typescript
interface EventRef { }
```

## MarkdownView

마크다운 편집기 뷰.

```typescript
class MarkdownView extends TextFileView {
    editor: Editor;              // 에디터 인스턴스
    previewMode: MarkdownPreviewView;  // 미리보기 모드
    currentMode: MarkdownSubView;      // 현재 모드
    getMode(): 'source' | 'preview' | 'live';
}
```

## MomentFormatComponent

`moment.js` 포맷 컴포넌트.

```typescript
// Obsidian은 moment를 내장 제공
import { moment } from 'obsidian';
```
