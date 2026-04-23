---
id: SPEC-WEB-FILE-VIEW-001
title: MinIO 바이너리 파일 웹 표시 및 다운로드 + Obsidian 위키링크 임베드
version: 1.0.0
status: Implemented
created_at: 2026-04-23
updated: 2026-04-23
author: yu
priority: High
issue_number: null
labels: [web, frontend, backend, file-viewer, minio, wiki-link]
---

## HISTORY

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| 1.0.0 | 2026-04-23 | 최초 작성 |

---

## 개요 (Overview)

Vector 웹 관리 인터페이스는 현재 마크다운 텍스트 파일만 표시할 수 있다.
MinIO에 저장된 바이너리 파일(이미지, PDF)은 조회할 수 없으며, Obsidian 위키링크
임베드 문법인 `![[image.png]]` 역시 렌더링되지 않는다.

본 SPEC은 웹 프론트엔드에서 바이너리 파일을 표시하고 다운로드하는 기능과,
마크다운 뷰어 내에서 위키링크 임베드를 실제 이미지로 렌더링하는 기능을 정의한다.

**범위**: 보기(View) + 다운로드(Download) 전용. 업로드, 편집, 삭제는 포함하지 않는다.

---

## 환경 가정 (Environment Assumptions)

- EA-001: 백엔드는 Fastify 5 + PostgreSQL 16 + MinIO(S3 호환) 스택을 사용한다.
- EA-002: 관리자 인증은 세션 쿠키 기반이다 (createAdminAuthMiddleware).
- EA-003: 바이너리 파일은 MinIO에 `{vaultId}/{filePath}/{versionNum}` 키 패턴으로 저장된다.
- EA-004: 파일 메타데이터는 `files` 테이블에 `fileType` 컬럼("markdown" | "attachment")으로 구분된다.
- EA-005: 플러그인 허용 확장자: .png, .jpg, .jpeg, .gif, .svg, .webp, .pdf, .mp3, .mp4, .wav, .ogg.
- EA-006: 웹 프론트엔드는 React + react-router-dom + TypeScript 기반이다.
- EA-007: 마크다운 렌더러는 ReactMarkdown + remarkGfm + rehypeRaw + rehypeHighlight를 사용한다.

---

## 요구사항 (Requirements)

### Phase 1: 백엔드 — 공유 유틸리티 및 관리자 첨부파일 라우트

#### REQ-001: Content-Type 감지 공유 유틸리티 (Ubiquitous)

The system **shall** provide a shared Content-Type detection utility that determines MIME types
from file extensions. This utility **shall** be used by both plugin API routes and admin routes,
replacing any inline Content-Type detection logic.

#### REQ-002: 관리자 파일 목록 응답에 file_type 필드 추가 (Event-Driven)

**When** 관리자가 `GET /admin/api/vaults/:id/files`를 요청하면,
the system **shall** 각 파일 항목에 `file_type` 필드("markdown" | "attachment")를
포함하여 응답한다.

현재 응답 스키마 `{path, size, updated_at}`에 `file_type` 필드가 누락되어 있다.
이 값은 `files.fileType` 컬럼에서 직접 조회한다.

#### REQ-003: 관리자 파일 상세 응답에 file_type 필드 추가 (Event-Driven)

**When** 관리자가 `GET /admin/api/vaults/:id/file/*`를 요청하면,
the system **shall** 응답에 `file_type` 필드("markdown" | "attachment")를
포함한다.

현재 응답 스키마 `{path, content, size, updated_at}`에 `file_type` 필드가 누락되어 있다.
첨부파일의 경우 `content`는 `null`이며, 이때 프론트엔드는 별도 첨부파일 API를 사용해야 한다.

#### REQ-004: 관리자 첨부파일 서빙 라우트 (Event-Driven)

**When** an authenticated admin requests a binary file via
`GET /admin/api/vaults/:id/attachment/*`,
the system **shall** retrieve it from object storage and return it with the
Content-Type header (확장자 기반 MIME 타입 감지).

인증: 기존 관리자 라우트와 동일하게 `createAdminAuthMiddleware`를 사용한다.
V1 플러그인 라우트(`GET /v1/vault/:id/attachment/*`)의 JWT 인증과는 분리된다.

#### REQ-005: 파일이 존재하지 않을 때 에러 응답 (Unwanted Behavior)

**If** 요청한 첨부파일이 MinIO에 존재하지 않으면,
**then** the system **shall** HTTP 404와 `{error: {code: "NOT_FOUND", message: "File not found"}}`
응답을 반환한다. 500 에러를 반환해서는 안 된다.

#### REQ-006: 관리자 첨부파일 라우트 인증 (Event-Driven)

**When** 인증되지 않은 요청이 관리자 첨부파일 라우트에 도달하면,
the system **shall** HTTP 401과 `{error: {code: "UNAUTHORIZED", message: "Authentication required"}}` 응답을 반환한다.

---

### Phase 2: 프론트엔드 — API 클라이언트 및 바이너리 파일 뷰어

#### REQ-007: VaultFile 인터페이스에 file_type 추가 (Ubiquitous)

The system **shall** provide a `VaultFile` interface that includes a `file_type` field
with values "markdown" or "attachment" alongside the existing path, size, and updated_at fields.

#### REQ-008: VaultFileContent 인터페이스에 file_type 추가 (Ubiquitous)

The system **shall** provide a `VaultFileContent` interface that includes a `file_type` field.
The `content` field **shall** accept both string and null values to reflect that attachments
have no text content.

#### REQ-009: 첨부파일 URL 생성 헬퍼 함수 (Ubiquitous)

The system **shall** provide a helper function that returns a URL string in the format
`/admin/api/vaults/{vaultId}/attachment/{encodedFilePath}` for use as image sources,
PDF embed sources, and download links. Session cookie authentication is used, so no
additional tokens or presigned URLs are required.

#### REQ-010: 바이너리 파일 뷰어 — 이미지 미리보기 (Event-Driven)

**When** 사용자가 이미지 파일(.png, .jpg, .jpeg, .gif, .svg, .webp)을 열면,
the system **shall** 파일 경로 하단에 이미지 미리보기를 표시한다.

이미지는 `<img>` 태그로 렌더링하며, `src`는 관리자 첨부파일 API URL을 사용한다.
최대 너비를 컨테이너에 맞추고 (max-width: 100%),
파일명을 대체 텍스트(alt)로 사용한다.

#### REQ-011: 바이너리 파일 뷰어 — PDF 임베드 (Event-Driven)

**When** 사용자가 PDF 파일(.pdf)을 열면,
the system **shall** `<embed>` 또는 `<iframe>` 태그로 PDF를 인라인 표시한다.

PDF 뷰어의 `src`는 관리자 첨부파일 API URL을 사용한다.
브라우저가 PDF 임베드를 지원하지 않는 경우, 다운로드 버튼만 표시한다.

#### REQ-012: 바이너리 파일 뷰어 — 다운로드 버튼 (Event-Driven)

**When** 사용자가 바이너리 파일(이미지 또는 PDF)을 열면,
the system **shall** 파일 메타데이터 영역에 다운로드 버튼을 표시한다.

다운로드 버튼은 `<a>` 태그에 `download` 속성과 `href`로 첨부파일 API URL을 사용한다.
버튼 클릭 시 브라우저가 파일을 다운로드한다.

#### REQ-013: 지원하지 않는 바이너리 파일 형식 처리 (State-Driven)

**While** 파일이 바이너리(attachment) 타입이지만 이미지나 PDF가 아닌 경우(예: .mp3, .mp4),
the system **shall** 파일 미리보기 대신 파일 정보와 다운로드 버튼만 표시한다.

지원 파일 형식:
- 이미지: .png, .jpg, .jpeg, .gif, .svg, .webp
- 문서: .pdf
- 기타 바이너리: 파일명, 크기, 날짜 정보 + 다운로드 버튼

#### REQ-014: 파일 목록에서 파일 타입 아이콘 구분 (Event-Driven)

**When** 파일 목록 트리 뷰가 렌더링되면,
the system **shall** 파일 확장자에 따라 서로 다른 아이콘을 표시한다.

아이콘 카테고리:
- 마크다운(.md): 문서 아이콘 (기존 동작 유지)
- 이미지(.png, .jpg, .jpeg, .gif, .svg, .webp): 이미지 아이콘
- PDF(.pdf): PDF 아이콘
- 기타 바이너리: 파일 아이콘

---

### Phase 3: 프론트엔드 — 위키링크 임베드 지원

#### REQ-015: 위키링크 임베드 전처리 (Event-Driven)

**When** ObsidianMarkdownViewer가 마크다운 콘텐츠를 렌더링하면,
the system **shall** `![[...]]` 패턴의 위키링크 임베드를 표준 마크다운 이미지
문법으로 변환한다.

변환 규칙:
- `![[photo.jpg]]` -> `![photo.jpg](/admin/api/vaults/{vaultId}/attachment/photo.jpg)`
- `![[images/photo.jpg]]` -> `![images/photo.jpg](/admin/api/vaults/{vaultId}/attachment/images/photo.jpg)`
- `![[photo.jpg|My Photo]]` -> `![My Photo](/admin/api/vaults/{vaultId}/attachment/photo.jpg)`

전처리는 ReactMarkdown에 콘텐츠를 전달하기 전에 수행한다.
비이미지 파일의 임베드는 변환하지 않고 원본 텍스트를 유지한다.

#### REQ-016: 위키링크 경로 해석 — 동일 디렉터리 우선 (State-Driven)

**While** 위키링크에 경로 구분자(`/`)가 없는 파일명만 포함된 경우 (예: `![[photo.jpg]]`),
the system **shall** 현재 마크다운 파일과 동일한 디렉터리에서 먼저 파일을 찾고,
찾지 못하면 전체 볼트에서 파일명으로 검색한다.

해석 순서:
1. `{currentDir}/{filename}` 경로로 파일 조회 시도
2. 실패 시, 볼트 전체에서 `{filename}`으로 끝나는 경로 검색
3. 모두 실패 시, 임베드를 깨진 이미지 플레이스홀더로 표시

이 해석을 위해 ObsidianMarkdownViewer는 vaultId와 현재 파일 경로를 prop으로
전달받아야 하며, 파일 목록 데이터(VaultFile[])에 접근해야 한다.

#### REQ-017: 위키링크 별칭(alias) 지원 (Event-Driven)

**When** 위키링크에 `|` 구분자가 포함되면 (예: `![[photo.jpg|My Photo]]`),
the system **shall** `|` 이후의 텍스트를 이미지의 대체 텍스트(alt)로 사용한다.

`![[photo.jpg|My Photo]]` -> `![My Photo](attachment-url)`
`![[photo.jpg]]` (별칭 없음) -> `![photo.jpg](attachment-url)`

#### REQ-018: 비이미지 위키링크 임베드 처리 (State-Driven)

**While** 위키링크 임베드가 이미지가 아닌 파일(PDF, 오디오 등)을 참조하면,
the system **shall** 이미지 렌더링 대신 파일명 링크를 표시한다.

표시 형식: `[filename.ext](attachment-url)` — 클릭 시 다운로드 또는 뷰어로 이동.

#### REQ-019: 존재하지 않는 위키링크 임베드 처리 (Unwanted Behavior)

**If** 위키링크가 참조하는 파일이 볼트에 존재하지 않으면,
**then** the system **shall** 빨간색 테두리의 플레이스홀더를 표시하고
"파일을 찾을 수 없음: {filename}" 메시지를 표시한다.

이 플레이스홀더는 깨진 이미지 아이콘 대신 명확한 시각적 피드백을 제공한다.

#### REQ-020: 텍스트 위키링크 — 마크다운 파일 링크 (Optional)

**Where** 마크다운 내에 `[[Another Note]]` 또는 `[[folder/note.md]]` 패턴이 존재하면,
the system **shall** 해당 패턴을 웹 뷰어 내부 링크로 변환한다.

변환 규칙:
- `[[Another Note]]` -> `[Another Note](/vaults/{vaultId}/view/Another%20Note.md)`
- `[[folder/note.md]]` -> `[folder/note.md](/vaults/{vaultId}/view/folder%2Fnote.md)`
- `[[Note|Display Text]]` -> `[Display Text](/vaults/{vaultId}/view/Note.md)`

이 요구사항은 우선순위가 낮으며, 이미지 임베드가 완전히 구현된 후에 작업한다.

---

### Cross-cutting Requirements

#### REQ-021: 코드 블록 내 위키링크 비변환 (State-Driven)

**While** wiki-link patterns appear inside fenced code blocks (```...```), the system **shall**
NOT transform those patterns and **shall** preserve them as literal text.

#### REQ-022: SVG 파일 보안 렌더링 (Ubiquitous)

The system **shall** render SVG files using `<img>` tags exclusively. SVG files **shall** NOT
be rendered using `<embed>`, `<iframe>`, or `<object>` tags to prevent script execution.

#### REQ-023: 위키링크 미해결 파일 플레이스홀더 (Unwanted Behavior)

**If** a wiki-link references a file that does not exist in the vault, the system **shall**
display a visible placeholder with the message indicating the file was not found, instead of
rendering a broken image or hiding the reference.

---

## 제약사항 (Constraints)

- CON-001: 업로드, 편집, 삭제 기능은 범위 밖이다. 보기와 다운로드만 구현한다.
- CON-002: Presigned URL을 사용하지 않는다. 세션 쿠키 인증으로 백엔드 프록시를 통해 바이너리를 제공한다.
- CON-003: 웹 프론트엔드는 기존 패턴(React 컴포넌트, Fastify 핸들러)을 따른다.
- CON-004: 총 변경 파일은 9개(신규 2개, 수정 7개)로 제한한다.
- CON-005: ObsidianMarkdownViewer의 기존 기능(코드 블록, 테이블, 체크리스트 등)은 변경하지 않는다.
- CON-006: V1 플러그인 API 라우트는 수정하지 않는다. 관리자 라우트만 추가한다.

---

## 제외 항목 (Exclusions — What NOT to Build)

- 파일 업로드 UI 및 엔드포인트 (플러그인이 담당)
- 파일 편집 기능 (텍스트 또는 바이너리)
- 파일 삭제 기능
- MinIO presigned URL 생성
- 오디오/비디오 인라인 재생 (다운로드 버튼만 제공)
- 파일 버전 히스토리 UI
- 파일 용량 쿼터 시스템 (ISSUE-001 참조)
- 드래그 앤 드롭 파일 업로드
- 이미지 크기 조절 또는 자르기 기능

---

## 의존성 (Dependencies)

- DEP-001: SPEC-WEB-001 (Vector 웹 관리 인터페이스) — 웹 프론트엔드 기반이 이미 구현되어 있어야 함
- DEP-002: `packages/server/src/services/attachment.ts` — `getAttachment()` 함수가 이미 구현되어 있음
- DEP-003: `packages/server/src/config/storage.ts` — MinIO S3 클라이언트가 이미 구현되어 있음

---

## 관련 파일 (Affected Files)

### 신규 파일 (2)
1. `packages/server/src/utils/content-type.ts` — guessContentType 공유 유틸리티
2. `packages/web/src/utils/wiki-link-resolver.ts` — 위키링크 해석 및 전처리

### 수정 파일 (7)
1. `packages/server/src/routes/v1.ts` — guessContentType import로 교체
2. `packages/server/src/routes/admin/file.route.ts` — file_type 필드 추가 + 첨부파일 라우트
3. `packages/web/src/api/client.ts` — 인터페이스 업데이트 + getVaultAttachmentUrl
4. `packages/web/src/pages/vault-file-view-page.tsx` — 바이너리 파일 뷰어
5. `packages/web/src/pages/vault-files-page.tsx` — 파일 타입 아이콘
6. `packages/web/src/components/obsidian-markdown-viewer/ObsidianMarkdownViewer.tsx` — 위키링크 임베드 + vault context props
7. `packages/web/src/components/obsidian-markdown-viewer/obsidian-markdown.css` — 위키링크 플레이스홀더 스타일

---

## 데이터 모델 변경 (Data Model Changes)

데이터베이스 스키마 변경은 없다. 기존 `files.fileType` 컬럼을 활용한다.

API 응답 스키마만 확장한다:
- `GET /admin/api/vaults/:id/files` 응답에 `file_type` 필드 추가
- `GET /admin/api/vaults/:id/file/*` 응답에 `file_type` 필드 추가
- `GET /admin/api/vaults/:id/attachment/*` 신규 엔드포인트 추가 (바이너리 응답)
