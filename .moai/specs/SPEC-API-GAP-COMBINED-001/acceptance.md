# SPEC-API-GAP-COMBINED-001: 인수 테스트 기준

## AC-PLG-001: Obsidian 내장 normalizePath 사용

### AC-PLG-001.1: 커스텀 normalizePath 제거

**Given** `packages/plugin/src/utils/path.ts` 파일에 `normalizePath` 함수가 정의되어 있지 않고
**When** plugin 코드베이스를 빌드하면
**Then** TypeScript 컴파일 에러가 발생하지 않는다.

```bash
cd packages/plugin && npx tsc --noEmit
```

### AC-PLG-001.2: Import 소스 변경 확인

**Given** `packages/plugin/src/sync-engine.ts` 파일에
**When** `normalizePath`에 대한 import 문을 확인하면
**Then** `normalizePath`가 `from 'obsidian'`에서 import되고, `shouldSyncPath`, `isObsidianPath`, `isBinaryPath`는 `from './utils/path'`에서 import된다.

### AC-PLG-001.3: 나머지 유틸리티 유지

**Given** `packages/plugin/src/utils/path.ts` 파일에서
**When** `normalizePath` 함수만 제거된 경우
**Then** 다음이 여전히 export된다: `ALLOWED_EXTENSIONS`, `isObsidianPath`, `isTrashPath`, `isConflictFile`, `getExtension`, `isBinaryPath`, `shouldSyncPath`, `validateVaultPath`

### AC-PLG-001.4: validateVaultPath 동작 보존

**Given** `validateVaultPath` 함수가
**When** 다음 입력에 대해 호출되면
**Then** 기존과 동일한 결과를 반환한다:
- `validateVaultPath("folder\\file.md")` -> `"folder/file.md"` (역슬래시 변환)
- `validateVaultPath("//folder//file.md")` -> `"folder/file.md"` (중복 슬래시 제거)
- `validateVaultPath("../secret")` -> Error throw (경로 순회 차단)
- `validateVaultPath("folder\0file")` -> Error throw (null byte 차단)

---

## AC-SRV-001: S3 클라이언트 싱글턴

### AC-SRV-001.1: 싱글턴 인스턴스 보장

**Given** 서버가 시작된 후
**When** `putObject`, `getObject`, `deleteObject`를 여러 번 호출하면
**Then** 동일한 `S3Client` 인스턴스가 사용된다.

### AC-SRV-001.2: 기존 API 호환성 유지

**Given** `storage.ts`의 `putObject`, `getObject`, `deleteObject` 함수가
**When** 외부에서 호출되면
**Then** 기존 함수 시그니처와 반환 타입이 변경되지 않는다.

### AC-SRV-001.3: ensureBucket 독립성

**Given** `ensureBucket()` 함수가
**When** 명시적 `s3` 파라미터 없이 호출되면
**Then** 싱글턴 클라이언트를 사용하여 버킷을 확인/생성한다.

---

## AC-SRV-002: FOR UPDATE 트랜잭션 래핑

### AC-SRV-002.1: 트랜잭션 내 실행 보장

**Given** `uploadFile`에서 baseHash 충돌이 감지되어 3-way merge가 실행될 때
**When** `SELECT ... FOR UPDATE`부터 merge 결과 저장, 버전 생성, 동기화 이벤트 생성까지의 전체 흐름이
**Then** 단일 `db.transaction()` 호출 내에서 실행된다.

### AC-SRV-002.2: 롤백 동작 검증

**Given** 3-way merge 트랜잭션 내에서
**When** 버전 생성 INSERT가 실패하면 (예: 제약 위반)
**Then** 파일 업데이트 및 merge 결과도 함께 롤백된다.

### AC-SRV-002.3: 경쟁 상태 보호

**Given** 동일 파일에 대해 두 개의 동시 충돌 업로드가 발생할 때
**When** 첫 번째 요청이 FOR UPDATE 락을 획득하면
**Then** 두 번째 요청은 첫 번째 트랜잭션이 완료될 때까지 대기한다.

---

## AC-SRV-003: 업로드 경쟁 상태 원자적 처리

### AC-SRV-003.1: 중복 INSERT 방지

**Given** `files_vault_path_uniq` UNIQUE INDEX가 존재하고
**When** 동일한 (vaultId, path)에 대해 두 개의 동시 신규 파일 업로드가 발생하면
**Then** 중복 레코드가 생성되지 않고, 두 번째 요청은 기존 파일에 대한 업데이트로 처리된다.

### AC-SRV-003.2: 정상 신규 생성 동작

**Given** 기존에 존재하지 않는 (vaultId, path)에 대해
**When** 파일 업로드가 발생하면
**Then** ON CONFLICT 없이 정상적으로 INSERT되고 버전 1 레코드가 생성된다.

### AC-SRV-003.3: 삭제 후 재업로드 복원

**Given** `deletedAt`이 설정된 파일에 대해
**When** 동일 path로 업로드가 발생하면
**Then** `deletedAt`이 `null`로 설정되어 파일이 복원된다.

---

## AC-SRV-004: 서버 경로 정규화 유틸리티

### AC-SRV-004.1: 유틸리티 함수 존재

**Given** `packages/server/src/utils/path.ts` 파일에
**When** `normalizePath` 함수가 정의되어 있으면
**Then** export되어 다른 모듈에서 import할 수 있다.

### AC-SRV-004.2: 정규화 동작 검증

**Given** `normalizePath` 함수가
**When** 다음 입력에 대해 호출되면
**Then** 각각 기대 결과를 반환한다:

| 입력 | 기대 결과 |
|------|-----------|
| `"/folder/file.md"` | `"folder/file.md"` |
| `"folder/file.md/"` | `"folder/file.md"` |
| `"///folder///file.md///"` | `"folder/file.md"` |
| `""` | `""` |
| `"/"` | `""` |
| `"folder/file.md"` | `"folder/file.md"` (변경 없음) |

### AC-SRV-004.3: 인라인 정규화 제거

**Given** `packages/server/src/services/file.ts`의 `listFolder` 함수에서
**When** `folder.replace(/^\/+|\/+$/g, "")` 패턴이
**Then** `normalizePath` 함수 호출로 대체되어 있다.

### AC-SRV-004.4: listFolder 동작 보존

**Given** `listFolder` 함수가
**When** 다음 입력에 대해 호출되면
**Then** 기존과 동일한 결과를 반환한다:
- `listFolder(db, vaultId, "/")` - 루트 폴더 내용
- `listFolder(db, vaultId, "notes")` - notes 폴더 내용
- `listFolder(db, vaultId, "/notes/")` - notes 폴더 내용 (동일 결과)

---

## 품질 게이트

### Definition of Done

- [ ] 모든 AC 시나리오의 Given-When-Then이 테스트로 구현됨
- [ ] `packages/plugin`에서 `npx tsc --noEmit` 통과
- [ ] `packages/server`에서 `npx tsc --noEmit` 통과
- [ ] 기존 테스트 스위트 전체 통과 (회귀 없음)
- [ ] `packages/server/src/utils/path.ts` 파일이 생성됨
- [ ] `packages/plugin/src/utils/path.ts`에서 `normalizePath`가 제거됨
- [ ] `packages/server/src/config/storage.ts`에서 싱글턴 패턴이 적용됨
- [ ] `packages/server/src/services/file.ts`에서 트랜잭션이 적용됨
- [ ] `packages/server/src/services/file.ts`에서 upsert 패턴이 적용됨

### 엣지 케이스

- 빈 문자열 경로에 대한 `normalizePath` 동작
- null/undefined 입력에 대한 방어 처리
- 트랜잭션 타임아웃 발생 시 동작
- S3Client 싱글턴 장애 후 복구
- 동시 요청 수가 높은 상황에서의 데드락 가능성
