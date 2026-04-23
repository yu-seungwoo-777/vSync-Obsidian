# Obsidian LiveSync vs Vector 비교 분석

> 작성일: 2026-04-17
> 대상: `_reference/obsidian-livesync/` (Reference) vs `plugin/` + `src/` (개발 중)

---

## 1. 개요

Obsidian LiveSync는 CouchDB 기반의 성숙한 오픈소스 동기화 플러그인으로, 수년간 프로덕션 환경에서 검증되었습니다. 본 프로젝트(Vector)는 PostgreSQL + MinIO 기반의 현대적 아키텍처로 동기화와 AI 통합을 결합하는 것을 목표로 합니다.

두 시스템의 아키텍처, 기능, 장단점을 비교하여 향후 개발 방향의 참고 자료로 활용합니다.

---

## 2. 아키텍처 비교

### 2.1 시스템 구성도

```
LiveSync 아키텍처:
┌─────────────────────────────────────────────────────────┐
│  Obsidian Plugin                                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │
│  │ PouchDB  │  │ Chunking │  │ E2EE (PBKDF2)        │ │
│  │ (Local)  │  │ Engine   │  │ Encryption           │ │
│  └────┬─────┘  └────┬─────┘  └───────────┬───────────┘ │
│       │              │                     │             │
│       └──────────────┼─────────────────────┘             │
│                      │ CouchDB Replication Protocol      │
└──────────────────────┼───────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
│  CouchDB    │ │   MinIO     │ │  P2P       │
│  (Primary)  │ │  (Optional) │ │  (WebRTC)  │
└─────────────┘ └─────────────┘ └────────────┘


Vector 아키텍처:
┌─────────────────────────────────────────────────────────┐
│  Obsidian Plugin                                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │
│  │ Sync     │  │ Hash     │  │ Offline Queue         │ │
│  │ Engine   │  │ (SHA-256)│  │ (Gradual Backoff)     │ │
│  └────┬─────┘  └──────────┘  └───────────────────────┘ │
│       │         REST API + Polling                      │
└───────┼─────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────┐
│  Fastify Server (Node.js 22)                            │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ PostgreSQL │  │   MinIO    │  │  Git Sync        │  │
│  │ (Metadata  │  │ (Attach-   │  │  (Backup)        │  │
│  │  + MD      │  │  ment)     │  │                  │  │
│  │  Content)  │  │            │  │                  │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 핵심 아키텍처 차이

| 영역 | LiveSync | Vector |
|------|----------|---------------|
| **로컬 DB** | PouchDB (IndexedDB) | 없음 (Vault 직접 접근) |
| **원격 DB** | CouchDB | PostgreSQL + MinIO |
| **저장 방식** | 청크 기반 (Content-Addressable) | PostgreSQL TEXT (마크다운) + MinIO (첨부파일) |
| **동기화 프로토콜** | CouchDB Replication Protocol | REST API + Polling |
| **런타임** | Frontend-heavy (Plugin 내부) | Client-Server (Fastify + Plugin) |
| **ORM** | 없음 (PouchDB Native) | Drizzle ORM (Type-safe) |
| **인증** | CouchDB 인증 + Device Token | API Key + bcrypt |
| **검색** | 없음 | pg_trgm 전체 텍스트 검색 (계획) |

---

## 3. 기능 비교

### 3.1 기능 매트릭스

| 기능 | LiveSync | Vector | 비고 |
|------|:--------:|:-------------:|------|
| **실시간 동기화** | ✅ | 🔄 폴링 (WebSocket 계획) | P3 단계에서 WebSocket 구현 예정 |
| **3-way 자동 병합** | ✅ diff-match-patch | ❌ 백업 후 덮어쓰기 | P5 단계에서 충돌 관리 구현 예정 |
| **E2EE 암호화** | ✅ PBKDF2 | ❌ | 향후 계획 |
| **P2P 동기화** | ✅ WebRTC | ❌ | 계획 없음 |
| **청크/중복 제거** | ✅ Content-Addressable | ❌ 불필요 (CouchDB 한계에 대한 우회책, 참고: 3.2절) |
| **설정/테마 동기화** | ✅ | ❌ | `.obsidian` 폴더 동기화 미지원 |
| **버전 히스토리** | ✅ PouchDB 내장 | ✅ PostgreSQL + fileVersions | 관계형 DB로 유연한 쿼리 |
| **AI 통합** | ❌ | ✅ 계획 중 | LLM Tool Use API |
| **Git 백업** | ❌ | ✅ 내장 | `npm run sync:git` |
| **다중 Vault** | ⚠️ 복잡 | ✅ Vault 단위 격리 | 멀티테넌시 설계 |
| **전체 Vault Export** | ❌ | ✅ API 제공 | `GET /v1/vault/:id/export` |
| **오프라인 큐** | ✅ PouchDB 기본 | ⚠️ 기본 구현 | 개선 필요 |
| **다중 백엔드** | ✅ CouchDB/MinIO/P2P | PostgreSQL/MinIO | MinIO 공통 사용 |
| **기기 관리** | ✅ 마일스톤 기반 | ✅ 커서 기반 | 접근 방식 상이 |

### 3.2 저장 방식 상세 비교

#### LiveSync: 청크 기반 저장

```
파일: "notes/project-plan.md"
       │
       ▼ 분할
┌──────────┬──────────┬──────────┐
│ Chunk h: │ Chunk h: │ Chunk h: │
│ a1b2c3   │ d4e5f6   │ g7h8i9   │
│ "---\nti"│ "tle:\nPr"│ "oject..." │
└──────────┴──────────┴──────────┘
       │
       ▼ 메타데이터
{
  _id: "notes/project-plan.md",
  children: ["h:a1b2c3", "h:d4e5f6", "h:g7h8i9"],
  type: "NOTE_PLAIN"
}
```

- 동일한 내용의 청크는 한 번만 저장 (중복 제거)
- 부분 업데이트 시 변경된 청크만 전송
- Eden 시스템으로 신규 청크 관리

**왜 LiveSync는 청킹을 사용하는가?**

CouchDB의 아키텍처 한계에 대한 우회책입니다:

| CouchDB 한계 | 청킹으로 해결하는 문제 |
|-------------|---------------------|
| **문서 단위 복제** | CouchDB Replication Protocol이 델타(변경분) 동기화를 지원하지 않음. 1MB 파일에서 한 줄 수정해도 1MB 전체 재전송. 청킹으로 변경된 청크만 전송 |
| **PouchDB/IndexedDB 한계** | 브라우저 IndexedDB에 용량 제한 (수백 MB~수 GB). 대용량 문서 저장 시 성능 저하. 청킹으로 분산 저장 |
| **중복 저장** | 여러 파일에 같은 템플릿 헤더가 있으면 각각 따로 저장. Content-Addressable 청크로 같은 해시는 1번만 저장 |

즉, 청킹은 **"문서 전체를 매번 복제해야 하는 프로토콜"**에 대한 최적화입니다.

#### Vector: PostgreSQL TEXT 저장

```
파일: "notes/project-plan.md"
       │
       ▼ SHA-256 해시 비교
"abc123...def456"
       │
       ▼ 해시가 다르면 PostgreSQL에 저장
PostgreSQL:
  files 테이블: content = "# Project Plan\n..." (TEXT 타입)
  fileVersions 테이블: version별 content 저장
MinIO: 이미지, 첨부파일 등 바이너리만 저장
```

- 마크다운 내용을 PostgreSQL `TEXT` 컬럼에 원본 그대로 저장
- 해시 비교로 동일 파일 업로드 스킵
- MinIO는 이미지/PDF 등 바이너리 첨부파일 전용

**왜 우리는 청킹이 필요 없는가?**

| CouchDB의 한계 | 우리의 상황 |
|----------------|------------|
| 문서 전체 복제 (델타 불가) | REST API로 필요한 데이터만 전송 |
| IndexedDB 용량 제한 | PostgreSQL 용량 제한 없음 |
| 전체 문서 재전송 | 해시 비교로 동일 파일 스킵 |
| 로컬 DB에 모든 데이터 저장 | 서버에만 저장, 클라이언트는 Vault 파일시스템 직접 사용 |
| 전용 복제 프로토콜 | 범용 REST API |

**TEXT 저장이 3-Way Merge에 유리한 이유:**

```
LiveSync (청크):
  청크 재조립 → 전체 텍스트 복원 → diff-match-patch → 병합
  (추가 단계 발생)

Vector (TEXT):
  base.content, left.content, right.content → diff-match-patch → 병합
  (바로 비교 가능)
```

PG에 TEXT로 저장하면 3-way merge 시 청크 재조립 과정이 생략되고, SQL 한 방으로 base/left/right 버전을 바로 조회할 수 있습니다.

### 3.3 충돌 해결 비교

#### LiveSync: 다층 충돌 해결

1. **자동 감지**: CouchDB `_rev` 충돌 감지
2. **3-way 병합**: diff-match-patch로 텍스트 자동 병합
3. **수동 해결**: 시각적 diff 편집기 제공
4. **정책 기반**: "새 버전 우선" 설정 가능
5. **바이너리**: 항상 새 버전 선택

#### Vector: 백업 후 덮어쓰기

1. **해시 비교**: SHA-256로 변경 감지
2. **백업 생성**: 충돌 시 기존 파일을 `.backup`으로 보존
3. **덮어쓰기**: 원격 버전으로 로컬 교체
4. **사용자 알림**: 상태바에 충돌 표시

---

### 3.4. 3-Way Merge 상세 분석 (LiveSync 구현 기준)

> 본 절에서는 LiveSync가 구현한 3-way 병합 메커니즘을 코드 수준에서 분석합니다.
> 이는 Vector의 P5(충돌 관리) 단계 설계 시 직접적인 참고 자료로 활용할 수 있습니다.

#### 3.4.1. 3-Way Merge란?

3-way merge는 **공통 조상(base)**을 기준으로 두 개의 변경된 버전을 비교하여 자동 병합하는 알고리즘입니다.

> **참고: 현재 Vector 방식과의 차이**
>
> 현재 Vector는 충돌 시 한쪽을 `.backup` 파일로 보존하고 서버 버전으로 덮어쓰는 방식입니다.
> 사용자가 직접 backup 파일을 열어서 눈으로 비교하고 수동 복구해야 합니다.
>
> 반면 3-Way Merge는 공통 조상을 알고 있기 때문에 대부분의 충돌을 **자동으로 병합**합니다.
> 자동 병합이 불가한 경우에만 Diff UI(팝업 모달)를 띄워 사용자가 선택하게 합니다.

```
           공통 조상 (Base)
           "Hello World"
            /         \
           /           \
    기기 A 수정       기기 B 수정
    "Hello Moon"      "Hello World!"
           \           /
            \         /
           병합 결과
           "Hello Moon!"
```

**핵심 원리**: 두 기기가 **다른 부분**을 수정한 경우 자동 병합이 가능하고, **같은 부분**을 수정한 경우 충돌로 간주하여 사용자 개입을 요청합니다.

#### 3.4.2. LiveSync의 3-Way Merge 흐름

LiveSync는 충돌을 발견하면 다음과 같은 단계로 처리합니다:

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: 충돌 감지                                      │
│  CouchDB _rev 충돌 → ModuleConflictChecker 큐에 등록    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: checkConflictAndPerformAutoMerge()             │
│  ├── localDatabase.tryAutoMerge() 시도                  │
│  │   ├── 성공 → 병합 결과 저장 후 충돌 리비전 삭제     │
│  │   └── 실패 → Step 3                                 │
│  ├── 내용 동일? → 최신 mtime 기준으로 오래된 리비전 삭제 │
│  ├── 바이너리 파일? → 최신 mtime 기준 선택             │
│  └── alwaysNewer 설정? → 최신 mtime 기준 선택          │
└───────────────────────┬─────────────────────────────────┘
                        │ 자동 병합 불가 (텍스트 충돌)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: diff-match-patch로 diff 생성                   │
│  dmp.diff_main(leftLeaf.data, rightLeaf.data)           │
│  → { left, right, diff } 결과 반환                      │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: 사용자에게 수동 해결 UI 제시                   │
│  ConflictResolveModal                                   │
│  ├── [Use Base]     → left 리비전 선택                  │
│  ├── [Use Conflicted] → right 리비전 선택               │
│  ├── [Concat both]  → 양쪽 내용 이어붙이기              │
│  └── [Not now]      → 나중에 처리                       │
└─────────────────────────────────────────────────────────┘
```

#### 3.4.3. 핵심 코드 분석: ModuleConflictResolver

LiveSync의 충돌 해결 핵심 로직 (`_reference/obsidian-livesync/src/modules/coreFeatures/ModuleConflictResolver.ts`):

#### (1) 1차 시도: 자동 병합

```typescript
async checkConflictAndPerformAutoMerge(path: FilePathWithPrefix): Promise<diff_check_result> {
    // PouchDB의 내장 3-way 병합 시도
    const ret = await this.localDatabase.tryAutoMerge(
        path,
        !this.settings.disableMarkdownAutoMerge
    );

    // Case A: 자동 병합 성공 → 바로 종료
    if ("ok" in ret) {
        return ret.ok;
    }

    // Case B: 병합된 콘텐츠가 반환됨 → 저장 후 충돌 리비전 삭제
    if ("result" in ret) {
        await this.core.databaseFileAccess.storeContent(path, ret.result);
        return await this.services.conflict.resolveByDeletingRevision(
            path, ret.conflictedRev, "Sensible"
        );
    }
    // ... 자동 병합 실패 시 아래 로직으로 계속
```

**여기서 `tryAutoMerge`가 하는 일**:
- PouchDB가 관리하는 문서의 여러 리비전(`_rev`) 중 충돌된 것들을 찾습니다.
- 공통 조상(base revision)을 자동 추적합니다.
- `diff-match-patch` 라이브러리를 사용해 base 기준으로 두 변경을 병합합니다.
- 병합이 가능하면(`"result"` 반환) 병합된 콘텐츠를 반환합니다.

#### (2) 2차 시도: 정책 기반 자동 해결

```typescript
    // 병합 불가 → left/right 리비전 확보
    const { rightRev, leftLeaf, rightLeaf } = ret;

    // 내용이 완전히 같은 경우 → 하나만 남기고 삭제
    const isSame = leftLeaf.data == rightLeaf.data
                   && leftLeaf.deleted == rightLeaf.deleted;

    // 바이너리 파일인 경우 → 텍스트 diff 불가
    const isBinary = !isPlainText(path);

    // 사용자가 "항상 새 버전 우선" 설정한 경우
    const alwaysNewer = this.settings.resolveConflictsByNewerFile;

    if (isSame || isBinary || alwaysNewer) {
        // mtime 비교 → 오래된 것 삭제
        const result = compareMTime(leftLeaf.mtime, rightLeaf.mtime);
        let loser = leftLeaf;
        if (result != TARGET_IS_NEW) {
            loser = rightLeaf;
        }
        return await this.services.conflict.resolveByDeletingRevision(
            path, loser.rev, subTitle
        );
    }
```

**자동 해결 조건** (우선순위):

| 조건 | 동작 | 이유 |
|------|------|------|
| `leftLeaf.data == rightLeaf.data` | 오래된 것 삭제 | 같은 내용이면 충돌 아님 |
| `!isPlainText(path)` | 오래된 것 삭제 | 바이너리는 diff/병합 불가 |
| `resolveConflictsByNewerFile == true` | 오래된 것 삭제 | 사용자 명시적 설정 |

#### (3) 3차: diff-match-patch로 diff 생성

```typescript
    // 텍스트 파일의 실제 충돌 → diff 생성
    const dmp = new diff_match_patch();
    const diff = dmp.diff_main(leftLeaf.data, rightLeaf.data);
    dmp.diff_cleanupSemantic(diff);  // diff 결과를 의미적으로 정리

    return {
        left: leftLeaf,    // 로컬(기준) 리비전
        right: rightLeaf,  // 충돌(원격) 리비전
        diff: diff,        // diff 결과 배열
    };
```

**`diff-match-patch` 라이브러리의 역할**:

Google의 `diff-match-patch`는 세 가지 기능을 제공합니다:
- **Diff**: 두 텍스트 간 차이점 계산
- **Match**: 텍스트 내 패턴 검색 ( fuzzy matching )
- **Patch**: diff를 패치로 적용

LiveSync는 **Diff** 기능을 사용하여 다음과 같은 결과를 생성합니다:

```typescript
// diff 결과 예시:
// [
//   [DIFF_EQUAL,  "Hello "],       // 공통 부분
//   [DIFF_DELETE, "Moon"],          // left에만 있고 right에 없음
//   [DIFF_INSERT, "World!"],        // right에만 있고 left에 없음
//   [DIFF_EQUAL,  "\nGood morning"] // 다시 공통 부분
// ]
```

#### (4) 수동 해결 UI: ConflictResolveModal

자동 병합이 불가한 경우, **별도의 팝업 모달(Diff UI)**을 띄워 사용자에게 충돌 내용을 시각적으로 보여줍니다.
이 모달은 Obsidian Plugin API의 `Modal` 클래스로 만든 팝업 창이며, **실제 markdown 파일 자체는 수정하지 않습니다**.
사용자가 버튼을 클릭해 선택한 결과로 파일을 수정합니다.

**Diff UI의 역할**: 마크다운 파일에 diff 표시를 넣는 것이 아닙니다.
Obsidian 화면 위에 팝업 창이 떠서 어디가 다른지 색깔로 보여주고, 사용자가 선택하면 팝업이 닫히고
그 때 선택한 내용으로 실제 파일이 수정됩니다. 별도의 `.backup` 파일이 생성되지 않습니다.

```
┌──────────────────────────────────────────────┐
│  Obsidian 화면                                │
│                                               │
│  ┌─ 열려있는 노트 (todo.md) ───────────────┐ │
│  │ # 회의록          ← 실제 파일, 그대로 유지 │ │
│  └───────────────────────────────────────────┘ │
│                                               │
│  ┌─ 충돌 해결 모달 (팝업, 위에 뜸) ────────┐ │
│  │ # 회의록              ← 회색 (공통)       │ │
│  │ ─ 담당자: 이디자인    ← 빨간 취소선       │ │
│  │ + 담당자: 김개발      ← 초록색            │ │
│  │ - 안건: 리뷰          ← 회색 (공통)       │ │
│  │                                          │ │
│  │ [Use Base] [Use Conflicted] [Concat]     │ │
│  └───────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
  모달 닫히면 → 선택한 결과로 .md 파일 수정 → .backup 파일 생성 안됨
```

```typescript
// diff를 HTML로 렌더링
for (const v of this.result.diff) {
    const x1 = v[0];  // DIFF_DELETE / DIFF_EQUAL / DIFF_INSERT
    const x2 = v[1];  // 텍스트 내용

    if (x1 == DIFF_DELETE) {
        // 빨간색: left(기준)에 있던 내용이 right에서 삭제됨
        diff += "<span class='deleted'>" + escapeStringToHTML(x2) + "</span>";
    } else if (x1 == DIFF_EQUAL) {
        // 회색: 공통 부분 (변경 없음)
        diff += "<span class='normal'>" + escapeStringToHTML(x2) + "</span>";
    } else if (x1 == DIFF_INSERT) {
        // 초록색: right(충돌)에서 추가된 내용
        diff += "<span class='added'>" + escapeStringToHTML(x2) + "</span>";
    }
}
```

**사용자에게 제시되는 옵션**:

| 버튼 | 동작 | 의미 |
|------|------|------|
| "Use Base" | `right.rev` 삭제 | 로컬 버전 유지, 충돌 리비전 폐기 |
| "Use Conflicted" | `left.rev` 삭제 | 원격 버전으로 교체 |
| "Concat both" | `LEAVE_TO_SUBSEQUENT` | 양쪽 내용을 이어붙여 보존 |
| "Not now" | `CANCELLED` | 나중에 다시 처리 |

#### 3.4.4. 사용자 경험 비교: 현재 방식 vs 3-Way Merge

| 상황 | 현재 (백업/덮어쓰기) | 3-Way Merge + Diff UI |
|------|----------------------|----------------------|
| 다른 줄 수정 | 한쪽 `.backup`으로 날아감, 수동 복구 | **자동 병합**, 양쪽 다 살음 |
| 같은 줄 수정 | 한쪽 `.backup`으로 날아감, 수동 복구 | **팝업 모달로 시각 비교 후 버튼 클릭** |
| 한쪽만 수정 | 서버 버전으로 덮어쓰기 | 자동 반영 (동일) |
| 파일 100개 동시 수정 | `.backup` 파일 100개 생성 | 대부분 자동 병합, 일부만 팝업 |

**핵심 차이**: 3-Way Merge가 있으면 일상적인 노트 작성에서 발생하는 대부분의 충돌이
사용자 개입 없이 자동 해결됩니다. 현재 방식은 모든 충돌이 수동 복구입니다.

#### 3.4.5. 3-Way Merge 시나리오 예시

#### 시나리오 1: 자동 병합 성공 (다른 줄 수정)

```
Base:     "# Meeting Notes\n- Agenda: TBD\n- Date: 2024-01-01"
Device A: "# Meeting Notes\n- Agenda: Project Review\n- Date: 2024-01-01"
Device B: "# Meeting Notes\n- Agenda: TBD\n- Date: 2024-01-15"

자동 병합 결과:
"# Meeting Notes\n- Agenda: Project Review\n- Date: 2024-01-15"
→ 서로 다른 줄을 수정했으므로 자동 병합 성공
```

#### 시나리오 2: 충돌 발생 (같은 부분 수정)

```
Base:     "# Meeting Notes\n- Agenda: TBD\n"
Device A: "# Meeting Notes\n- Agenda: Sprint Planning\n"
Device B: "# Meeting Notes\n- Agenda: Bug Triage\n"

→ 같은 "Agenda" 줄을 서로 다르게 수정
→ diff-match-patch가 diff 생성
→ 사용자에게 UI 제시
```

#### 시나리오 3: 내용 동일 (false conflict)

```
Base:     "# TODO\n- Buy milk"
Device A: "# TODO\n- Buy milk\n- Call mom"
Device B: "# TODO\n- Buy milk\n- Call mom"

→ leftLeaf.data == rightLeaf.data
→ 동일하므로 하나만 유지하고 나머지 삭제
```

#### 시나리오 4: 바이너리 파일 충돌

```
Device A: image.png (mtime: 2024-01-15 10:00)
Device B: image.png (mtime: 2024-01-15 09:00)

→ isBinary == true
→ mtime 비교 → Device A가 최신 → Device B 리비전 삭제
```

#### 3.4.6. 3-Way Merge의 한계

LiveSync의 구현에서도 3-way merge가 만능은 아닙니다:

| 한계 | 설명 |
|------|------|
| **의미적 충돌** | 문법적으로는 병합되지만 논리적으로 모순될 수 있음 (예: 같은 회의를 두 곳에서 다른 날짜로 잡음) |
| **줄 단위 제한** | diff-match-patch는 줄/문자 단위 비교이므로 구조적 변경(마크다운 헤더 이동 등)을 이해하지 못함 |
| **순서 충돌** | 같은 위치에 항목을 추가한 경우 순서를 결정하지 못함 |
| **대용량 파일** | diff 계산 비용이 파일 크기에 비례 (100KB 초과 시 UI에서 diff 표시 생략) |

#### 3.4.7. Vector 적용 설계 참고

LiveSync의 패턴을 Vector 아키텍처에 적용할 때의 설계 고려사항:

#### 서버 측 3-Way Merge (추천)

```
PostgreSQL 기반 구조:

files 테이블:
  ├── id, path, vault_id, content_hash, ...
  └── current_version_id → fileVersions 참조

fileVersions 테이블:
  ├── id, file_id, version_num, content_hash, s3_key
  ├── base_version_id  ← NEW: 공통 조상 참조
  └── merge_type: "auto" | "manual" | "conflict"

충돌 감지 흐름:
1. 클라이언트가 PUT 요청 (content + content_hash)
2. 서버가 현재 버전의 content_hash와 비교
3. 다르면:
   a. base_version 찾기 (공통 조상)
   b. 서버에서 diff-match-patch로 3-way 병합 시도
   c. 성공 → 병합 결과 저장, 양쪽에 알림
   d. 실패 → 충돌 이벤트 발행, 클라이언트에 diff 전송
```

#### 클라이언트 측 UI

```
Obsidian 플러그인에서의 충돌 해결 모달:

1. diff-match-patch를 브라우저/Node 환경에서 사용 가능
   (npm 패키지: diff-match-patch, ~30KB)

2. ConflictResolveModal과 유사한 Obsidian Modal 구현:
   ├── 빨간색: 로컬에서 삭제된 내용
   ├── 초록색: 원격에서 추가된 내용
   ├── 회색: 공통 부분
   └── 버튼: [로컬 유지] [원격 적용] [둘 다 보존] [나중에]

3. Obsidian의 기본 diff 뷰어를 활용할 수도 있음
```

#### 핵심 차이점: PouchDB vs PostgreSQL

| 측면 | LiveSync (PouchDB) | Vector (PostgreSQL) |
|------|--------------------|-----------------------------|
| **공통 조상 추적** | `_rev` 히스토리에서 자동 추적 | `base_version_id` 컬럼으로 명시적 추적 필요 |
| **충돌 감지** | `_conflicts` 메타데이터로 자동 | `content_hash` 비교로 수동 감지 |
| **병합 실행 위치** | 클라이언트 (Plugin 내부) | 서버 또는 클라이언트 (선택 가능) |
| **리비전 관리** | CouchDB 내장 MVCC | fileVersions 테이블로 직접 관리 |

#### 권장 라이브러리

| 라이브러리 | 용도 | 크기 | 라이선스 |
|-----------|------|------|---------|
| `diff-match-patch` | Google의 diff/merge 라이브러리 (LiveSync와 동일) | ~30KB | Apache 2.0 |
| `diff` (npm) | 텍스트 diff 생성 | ~15KB | BSD |
| `jsdiff` | 다양한 diff 알고리즘 | ~25KB | MIT |

**권장**: `diff-match-patch` 사용 — LiveSync와 동일한 라이브러리로 검증된 알고리즘, 브라우저와 Node.js 모두 지원.

---

## 4. 장단점 분석

### 4.1 LiveSync 장점

| 항목 | 설명 |
|------|------|
| **성숙도** | 수년간 프로덕션 환경에서 검증된 안정성 |
| **청크 효율성** | Content-Addressable 청크로 대역폭 절약 (단, CouchDB 프로토콜 한계에 대한 우회책) |
| **자동 병합** | diff-match-patch 기반 3-way 병합으로 수동 개입 최소화 |
| **E2EE** | 종단간 암호화(PBKDF2)로 프라이버시 보장 |
| **P2P 옵션** | WebRTC로 서버 없이 기기 간 직접 동기화 |
| **CouchDB Replication** | 검증된 분산 동기화 프로토콜, 오프라인-온라인 전환 자연스러움 |
| **설정 동기화** | `.obsidian` 디렉토리 포함 설정/테마/플러그인 동기화 |
| **다중 백엔드** | CouchDB, MinIO, P2P 중 선택 가능 |

### 4.2 LiveSync 단점

| 항목 | 설명 |
|------|------|
| **CouchDB 의존성** | 운영 복잡도 높음, CouchDB 설정/관리/튜닝 전문 지식 필요 |
| **복잡도 과다** | 청킹, Eden, 마일스톤 등 개념이 많아 유지보수 어려움 |
| **PouchDB 한계** | IndexedDB 기반으로 대규모 Vault에서 용량/성능 문제 |
| **코드베이스 방대** | ~30,000+ 라인, 진입 장벽 높음 |
| **AI/검색 없음** | 순수 동기화에만 집중, 지능형 문서 관리 불가 |
| **Git 통합 없음** | 버전 관리 시스템과의 연동 부재 |

### 4.3 Vector 장점

| 항목 | 설명 |
|------|------|
| **현대적 스택** | Node.js 22 + Fastify 5 + TypeScript + Drizzle ORM |
| **관계형 DB** | PostgreSQL의 ACID, 풀텍스트 검색(pg_trgm), 조인 쿼리 활용 |
| **메타-바이너리 분리** | PostgreSQL(메타데이터+마크다운) + MinIO(첨부파일) 각각 최적화된 저장소 |
| **AI 통합 비전** | LLM Tool Use로 문서 검색/생성/수정 자동화 경로 |
| **Git 백업** | `npm run sync:git`으로 자동 버전 관리 |
| **Vault 격리** | 멀티테넌시 설계로 다중 Vault 깔끔하게 지원 |
| **간결한 구조** | 이해하기 쉽고 확장 가능한 아키텍처 |
| **Full Export** | `GET /v1/vault/:id/export` 전체 Vault 덤프 |

### 4.4 Vector 단점

| 항목 | 설명 |
|------|------|
| **실시간 미지원** | 폴링 기반, WebSocket 구현 필요 (P3) |
| **충돌 해결 단순** | 3-way 병합 없이 백업 후 덮어쓰기 (P5) |
| **전체 파일 전송** | 청킹 없이 파일 전체를 매번 전송하나, 마크다운은 보통 1~50KB로 실질적 부담 없음 |
| **E2EE 미구현** | 암호화 계획만 존재 |
| **오프라인 제한** | 큐 기본 구현만 있음, PouchDB 수준의 오프라인 지원 필요 |
| **설정 동기화 없음** | `.obsidian` 폴더 동기화 미지원 |

---

## 5. 개발 방향과 제언

### 5.1 현재 개발 로드맵

```
P0 (완료) ─→ P1 (완료) ─→ P4 (완료) ─→ P3 (실시간) ─→ P5 (충돌) ─→ P6 (AI) ─→ P7 (프로덕션)
  MD→DB       멀티접근      Plugin MVP     WebSocket      충돌관리      AI Tool Use    완성도
```

### 5.2 LiveSync와의 차별화 전략

```
LiveSync    = "CouchDB 생태계의 동기화 전문 도구"
Vector = "PostgreSQL 기반 AI 통합 지식 관리 플랫폼"
```

LiveSync를 단순히 "따라잡는" 것이 아니라, **동기화 기본기 + AI 통합**이라는 두 축에서 확실한 우위를 확보하는 전략이 효과적입니다.

#### 차별화 축 1: AI-First 접근 (P6)

LiveSync가 절대 가질 수 없는 차별점:

- **LLM Tool Commands**: 규격화된 명령어로 AI가 문서를 안전하게 조작
  - `read_document`: 문서 읽기
  - `write_document`: 문서 생성/수정 (버전·해시·이벤트 자동 처리)
  - `edit_document`: 부분 수정 (치환 기반, 버전 자동 생성)
  - `search_documents`: pg_trgm 풀텍스트 검색
  - `list_documents`: 폴더 단위 목록 조회
  - `upload_attachment`: 이미지/PDF 등 첨부파일 (MinIO 저장)
- pg_trgm 기반 전체 텍스트 검색으로 Vault 지능형 탐색
- AI가 생성한 문서가 즉시 모든 기기에 동기화되는 워크플로우
- **Service Layer 공유**: Plugin·LLM·CLI 모두 같은 규칙(버전·해시·이벤트) 적용
- LLM이 직접 SQL을 작성하지 않아 무결성·보안 보장

#### 차별화 축 2: 현대적 인프라

- PostgreSQL: ACID, 풀텍스트 검색, 분석 쿼리, 확장성
- MinIO: S3 호환 스토리지로 수평 확장 가능
- Kubernetes 친화적 아키텍처
- Drizzle ORM으로 타입 안전한 스키마 관리

#### 차별화 축 3: 개발자 경험

- Git 백업 내장
- REST API + 향후 WebSocket으로 명확한 API 계약
- Vault 단위 격리로 다중 사용자 지원
- Full Export API로 데이터 이식성 보장

### 5.3 우선순위 제언

LiveSync와의 격차 해소 및 차별화 강화를 위한 권장 우선순위:

| 우선순위 | 항목 | 이유 | 관련 Phase |
|----------|------|------|-----------|
| **P0** | WebSocket 실시간 동기화 | 폴링은 UX의 결정적 한계, 실시간 체감이 핵심 | P3 |
| **P0** | 3-way 자동 병합 | 텍스트 노트 동기화의 핵심 기능, 충돌 빈도 높음 | P5 |
| **P1** | 청크 기반 전송 | CouchDB 프로토콜 한계에 대한 우회책이며, REST API 환경에서는 불필요. 대용량 바이너리(이미지/PDF)에만 향후 고려 | 신규 |
| **P1** | 오프라인 큐 강화 | 모바일 환경 안정성, 네트워크 불안정 환경 대응 | P3 |
| **P2** | E2EE | 프라이버시 요구사항, 보안 민감 사용자층 확보 | 신규 |
| **P2** | `.obsidian` 설정 동기화 | 사용자 경험 완성도, 다른 동기화 도구와의 기능 패리티 | 신규 |
| **P3** | AI Tool Use API | LiveSync 대비 확실한 차별점, 새로운 사용 사례 창출 | P6 |

### 5.4 LiveSync에서 참고할 점

LiveSync의 검증된 패턴 중 도입을 고려할 만한 요소:

| 패턴 | 참고 포인트 | 적용 방식 |
|------|------------|----------|
| **충돌 해결 UI** | 시각적 diff 편집기는 훌륭한 UX 패턴 | Obsidian의 diff 뷰 또는 커스텀 모달로 구현 |
| **청킹 전략** | Content-Addressable 청크는 CouchDB 한계에 대한 우회책 | 우리 아키텍처에는 불필요. 대용량 바이너리 전송 시에만 참고 |
| **마일스톤 기반 동기화** | 기기별 동기화 상태 추적 | 현재 커서 기반 추적을 보완하는 참고 모델 |
| **자동 복구** | 데이터베이스 손상 시 복구 메커니즘 | 파일 히스토리 기반 복구 로직 설계 시 참고 |
| **설정 동기화** | 플러그인/테마 설정의 버전 관리 | `.obsidian` 디렉토리 특수 처리 로직 |

---

## 6. 결론

Vector는 현재 동기화 기능 면에서 LiveSync에 뒤처지지만, **AI 통합과 현대적 스택**이라는 명확한 차별화 축을 보유하고 있습니다.

전략적 권장 사항:

1. **P3(실시간) + P5(충돌관리)로 동기화 기본기를 먼저 완성** — LiveSync와의 기능 격차 해소
2. **P6(AI)에서 LiveSync가 가질 수 없는 우위 확보** — AI 통합 지식 관리 플랫폼으로의 포지셔닝
3. **청킹 도입으로 대용량 Vault 지원 강화** — 장기적으로 필요한 인프라 개선
4. **E2EE와 설정 동기화로 완성도 제고** — 사용자 이탈 방지

최종 목표는 "더 나은 LiveSync"가 아니라 **"동기화가 내장된 AI 지식 관리 플랫폼"**이 되는 것입니다.
