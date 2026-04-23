# SPEC-API-GAP-COMBINED-001: 구현 계획

## 개요

Plugin 1건 + Server 4건의 아키텍처 개선 및 경쟁 상태 수정을 위한 구현 계획. 패키지별로 독립적인 수정이 가능하며, server 측 수정은 `uploadFile` 함수를 중심으로 밀접하게 연관되어 있다.

## 마일스톤

### Milestone 1: Server 유틸리티 기반 작업 (Priority: High)

**대상**: REQ-SRV-004

**수정 파일**:
- `packages/server/src/utils/path.ts` (신규 생성)
- `packages/server/src/services/file.ts` (인라인 정규화 교체)

**기술적 접근**:
- `packages/server/src/utils/path.ts`에 `normalizePath` 함수 생성
- 동작: 선행/후행 슬래시 제거 + 중복 슬래시 제거
- `listFolder` 함수 내 `folder.replace(/^\/+|\/+$/g, "")`를 `normalizePath(folder)`로 교체
- 기존 동작과 완전히 동일한 결과 보장 (회귀 테스트로 검증)

---

### Milestone 2: Plugin normalizePath 교체 (Priority: Medium)

**대상**: REQ-PLG-001

**수정 파일**:
- `packages/plugin/src/utils/path.ts` (normalizePath 함수 제거)
- `packages/plugin/src/sync-engine.ts` (import 변경)

**기술적 접근**:
- `sync-engine.ts`의 import 문에서 `normalizePath`를 제거하고 `import { normalizePath } from 'obsidian'` 추가
- `path.ts`에서 `normalizePath` 함수 삭제
- `path.ts`의 `validateVaultPath`가 내부적으로 `normalizePath`를 호출하므로, 이 함수도 Obsidian의 `normalizePath`를 import하도록 변경
- sync-engine.ts의 사용 위치(6곳) 모두 정상 동작 확인

**주의사항**:
- `validateVaultPath`가 `normalizePath`를 내부적으로 사용하므로, `path.ts`에서도 `import { normalizePath } from 'obsidian'`이 필요하다.
- Obsidian plugin 컨텍스트에서만 `obsidian` 모듈을 import할 수 있다.

---

### Milestone 3: S3 클라이언트 싱글턴 (Priority: High)

**대상**: REQ-SRV-001

**수정 파일**:
- `packages/server/src/config/storage.ts`

**기술적 접근**:
- 모듈 레벨에서 싱글턴 S3Client 생성: `let s3Client: S3Client | null = null;`
- `getS3Client()` 함수 추가: 최초 호출 시 생성, 이후 동일 인스턴스 반환
- `putObject`, `getObject`, `deleteObject`에서 `createS3Client()` 대신 `getS3Client()` 사용
- `ensureBucket()`은 기존대로 선택적 `s3` 파라미터 지원 유지 (초기화 시점 유연성)
- 테스트를 위한 `resetS3Client()` 함수 선택적 추가

**패턴**:
```typescript
let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = createS3Client();
  }
  return s3Client;
}
```

---

### Milestone 4: uploadFile 트랜잭션 + upsert (Priority: High)

**대상**: REQ-SRV-002 + REQ-SRV-003

**수정 파일**:
- `packages/server/src/services/file.ts`

**기술적 접근**:

#### REQ-SRV-002: FOR UPDATE 트랜잭션 래핑
- 3-way merge 경로(line 89-194) 전체를 `db.transaction(async (tx) => { ... })`로 래핑
- `db.execute(sql`SELECT ... FOR UPDATE`)`를 `tx.execute(sql`SELECT ... FOR UPDATE`)`로 변경
- merge 결과 저장, 파일 업데이트, 버전 생성, 동기화 이벤트 생성 모두 `tx` 사용
- MinIO `putObject`는 트랜잭션 외부에서 유지 (2PC 미지원)
- 트랜잭션 실패 시 자동 롤백 보장

#### REQ-SRV-003: 업로드 경쟁 상태 원자적 처리
- 신규 파일 INSERT에 `.onConflictDoNothing({ target: [files.vaultId, files.path] })` 적용
- INSERT 결과가 빈 배열이면 (충돌 발생), `findFileByPath`로 기존 레코드를 재조회하여 업데이트 경로로 처리
- 또는 `.onConflictDoUpdate()`를 사용하여 upsert 패턴 적용
- 전체 신규 생성 로직(line 288-328)을 트랜잭션으로 래핑

**구현 순서**:
1. `uploadFile` 함수 내 트랜잭션 경계 식별
2. 3-way merge 경로 트랜잭션 래핑 (REQ-SRV-002)
3. 신규 파일 생성 경로 upsert 적용 (REQ-SRV-003)
4. 기존 파일 업데이트 경로 트랜잭션 검토

---

## 리스크

| 리스크 | 영향도 | 완화 방안 |
|--------|--------|-----------|
| Obsidian 내장 `normalizePath`와 커스텀 구현의 미묘한 동작 차이 | Medium | 단위 테스트로 동등성 검증 |
| 트랜잭션 도입으로 인한 데드락 가능성 | Medium | FOR UPDATE 사용 시 인덱스 활용 확인, 타임아웃 설정 |
| 싱글턴 S3Client 장애 시 복구 | Low | 연결 끊김 감지 시 재생성 로직 추가 |
| upsert 패턴 도입 시 Drizzle ORM 호환성 | Low | Drizzle PG upsert 문서 확인, 기존 UNIQUE INDEX 활용 |

## 테스트 전략

- REQ-PLG-001: `normalizePath` 동등성 테스트 (Obsidian 내장 vs 기존 커스텀)
- REQ-SRV-001: S3Client 인스턴스 동일성 테스트, 연결 재사용 검증
- REQ-SRV-002: 동시 업로드 시나리오 테스트, 트랜잭션 롤백 테스트
- REQ-SRV-003: 동시 INSERT 시나리오 테스트, upsert 동작 검증
- REQ-SRV-004: `normalizePath` 단위 테스트, 기존 동작 회귀 테스트
