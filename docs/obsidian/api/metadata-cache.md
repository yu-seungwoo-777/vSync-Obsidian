# MetadataCache API

파일의 메타데이터(헤딩, 링크, 태그, 프론트매터 등)를 캐싱하고 제공하는 API.

```typescript
export class MetadataCache extends Events
```

## 메서드

### `getFileCache(file: TFile): CachedMetadata | null`

파일의 캐시된 메타데이터 조회. 인덱싱 전이면 `null`.

```typescript
const file = this.app.vault.getFileByPath('my-note.md');
const cache = this.app.metadataCache.getFileCache(file);

if (cache?.headings) {
    cache.headings.forEach(h => console.log(`H${h.level}: ${h.heading}`));
}
if (cache?.tags) {
    const tags = cache.tags.map(t => t.tag);
}
if (cache?.frontmatter) {
    const title = cache.frontmatter.title;
}
```

### `getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null`

링크 경로를 실제 파일로 해석. `sourcePath` 기준으로 상대 경로 해석.

```typescript
const targetFile = this.app.metadataCache.getFirstLinkpathDest(
    'My Note',
    'folder/current-note.md'
);
```

### `resolvedLinks: Record<string, Record<string, number>>`

모든 해결된 링크 맵. 소스 파일 → 대상 파일 → 링크 개수.

```typescript
const links = this.app.metadataCache.resolvedLinks;
// { "notes/a.md": { "notes/b.md": 2, "notes/c.md": 1 } }
```

### `unresolvedLinks: Record<string, Record<string, number>>`

모든 미해결 링크 맵. 소스 파일 → 대상 문자열 → 개수.

```typescript
const unresolved = this.app.metadataCache.unresolvedLinks;
// { "notes/a.md": { "Missing Note": 1 } }
```

## 이벤트

### `changed`

파일이 인덱싱되고 캐시가 준비되었을 때 발생. **파일 이름 변경 시에는 호출되지 않음** (성능상 이유). rename은 `Vault.on('rename')` 사용.

```typescript
on(name: 'changed',
   callback: (file: TFile, data: string, cache: CachedMetadata) => any,
   ctx?: any): EventRef;
```

```typescript
this.registerEvent(
    this.app.metadataCache.on('changed', (file, data, cache) => {
        console.log(`Metadata updated: ${file.path}`);
    })
);
```

### `resolved`

파일의 링크가 모두 해결되었을 때.

```typescript
on(name: 'resolved', callback: () => any, ctx?: any): EventRef;
```

## CachedMetadata 하위 타입

### HeadingCache

```typescript
interface HeadingCache {
    heading: string;        // 헤딩 텍스트
    level: number;          // 레벨 (1-6)
    position: EditorRange;  // 문서 내 위치
}
```

### LinkCache

```typescript
interface LinkCache {
    link: string;           // 링크 대상 경로
    original: string;       // 원본 마크다운 텍스트
    displayText?: string;   // 표시 텍스트
    position: EditorRange;
}
```

### EmbedCache

```typescript
interface EmbedCache {
    link: string;           // 임베드 대상 경로
    original: string;       // 원본 마크다운 텍스트
    position: EditorRange;
}
```

### TagCache

```typescript
interface TagCache {
    tag: string;            // 태그 ('#tag' 형식)
    position: EditorRange;
}
```

### SectionCache

```typescript
interface SectionCache {
    type: string;           // 섹션 타입
    position: EditorRange;
}
```

### FrontMatterInfo

```typescript
interface FrontMatterInfo {
    position: EditorRange;
    [key: string]: any;     // 프론트매터 필드
}
```

## 유틸리티 함수

### `getAllTags(cache: CachedMetadata): string[]`

캐시에서 모든 태그 추출.

```typescript
import { getAllTags } from 'obsidian';
const tags = getAllTags(cache); // ['#tag1', '#tag2']
```

### `parseFrontMatterTags(frontmatter: any): string[] | null`

프론트매터에서 태그 추출.

```typescript
import { parseFrontMatterTags } from 'obsidian';
const tags = parseFrontMatterTags(cache.frontmatter);
```

### `parseFrontMatterAliases(frontmatter: any): string[] | null`

프론트매터에서 별칭 추출.
