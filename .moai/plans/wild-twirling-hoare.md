# Plan: Vector Monorepo Restructuring

## Context

프로젝트를 "obsidian-sync-db"에서 "vector"로 이름 변경하고, 서버/플러그인/웹을 npm workspaces 기반 모노레포로 재편성한다. 기능 변경 없이 폴더 구조만 변경.

**최종 목표**: Obsidian을 대체하는 자체 지식 관리 플랫폼. 웹 클라이언트 추가를 위한 구조 선작업.

## Target Structure

```
vector/                              # 루트 (npm workspaces)
├── packages/
│   ├── server/                      # @vector/server
│   │   ├── src/                     # 현재 src/ 그대로 이관
│   │   ├── tests/                   # 현재 tests/ 이관
│   │   ├── drizzle.config.ts        # 현재 루트에서 이관
│   │   ├── package.json             # 신규 (@vector/server)
│   │   ├── tsconfig.json            # 신규
│   │   ├── vitest.config.ts         # 신규
│   │   └── eslint.config.js         # 신규
│   │
│   ├── plugin/                      # @vector/plugin
│   │   ├── src/                     # 현재 plugin/src/ 이관
│   │   ├── tests/                   # 현재 plugin/tests/ 이관
│   │   ├── manifest.json            # 플러그인 매니페스트
│   │   ├── esbuild.config.mjs       # 빌드 설정
│   │   ├── package.json             # 이름 변경
│   │   ├── tsconfig.json            # 수정
│   │   └── vitest.config.ts         # 수정
│   │
│   └── web/                         # @vector/web (초기 스캐폴드)
│       ├── src/
│       │   └── App.tsx              # 빈 뼈대
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── docs/                            # 공유 (root 유지)
│   └── api/openapi.yaml
├── eslint.shared.mjs                # 공유 ESLint (root 유지)
├── tsconfig.base.json               # 공유 TS 베이스 (신규)
├── vitest.workspace.ts              # Vitest 워크스페이스 (신규)
├── package.json                     # 루트 워크스페이스 (신규)
├── .env                             # 환경변수 (root 유지)
├── .env.example                     # 환경변수 예시 (root 유지)
├── .gitignore                       # 수정
├── CLAUDE.md                        # 프로젝트명 업데이트
└── README.md                        # 프로젝트명 업데이트
```

## Execution Steps

### Step 1: 루트 워크스페이스 설정 (3 files)

**1a. 루트 package.json 신규 작성**
- `name: "vector"`, `private: true`
- `workspaces: ["packages/*"]`
- 통합 스크립트: dev, build, test, lint, generate-types

**1b. tsconfig.base.json 신규 작성**
- 공유 compilerOptions (target: ES2024, module: NodeNext 등)
- 각 패키지에서 extends로 참조

**1c. vitest.workspace.ts 신규 작성**
- `packages/*/vitest.config.ts` 포함

### Step 2: packages/server/ 생성 및 이관 (~15 files)

**이관 대상:**
- `src/` → `packages/server/src/` (전체 디렉토리)
- `tests/` → `packages/server/tests/` (전체 디렉토리)
- `drizzle.config.ts` → `packages/server/drizzle.config.ts`

**신규/수정 파일:**
- `packages/server/package.json` - `name: "@vector/server"`, 기존 scripts 유지
- `packages/server/tsconfig.json` - `extends: "../../tsconfig.base.json"`
- `packages/server/vitest.config.ts` - 경로 수정 없음 (상대경로 유지)
- `packages/server/eslint.config.js` - `extends` 공유 설정 참조

**수정 불필요:**
- src/ 내 모든 .ts 파일 (import가 이미 상대경로)
- drizzle.config.ts (이미 `./src/` 상대경로)

### Step 3: packages/plugin/ 이관 (~25 files)

**이관 방식:**
- `plugin/` 전체를 `packages/plugin/`으로 이동

**수정 파일:**
- `packages/plugin/package.json` - `name: "@vector/plugin"`
- `packages/plugin/tsconfig.json` - `extends: "../../tsconfig.base.json"` (옵션 오버라이드)
- `packages/plugin/esbuild.config.mjs` - 변경 없음 (src/main.ts → main.js, 상대경로)
- `packages/plugin/vitest.config.ts` - 변경 없음 (상대경로)
- `packages/plugin/manifest.json` - `id: "vector"`, `name: "Vector"` 로 변경
- `packages/plugin/.gitignore` - 변경 없음
- `packages/plugin/src/types/api-types.ts` 경로 참조: `../docs/api/openapi.yaml` → `../../../docs/api/openapi.yaml`

**수정 불필요:**
- src/ 내 모든 .ts 파일 (import가 이미 상대경로)
- 테스트 파일들

### Step 4: packages/web/ 스캐폴드 (5 files)

최소 동작 가능한 Vite + React + TypeScript 뼈대:
- `package.json` - `name: "@vector/web"`, vite, react 의존성
- `tsconfig.json` - `extends: "../../tsconfig.base.json"`
- `vite.config.ts` - 빌드 출력을 `packages/server/`에서 서빙 가능하도록 설정
- `index.html` - 진입점
- `src/App.tsx` - 빈 컴포넌트

### Step 5: 공유 설정 업데이트 (4 files)

**5a. eslint.shared.mjs**
- 주석에서 "obsidian-sync-db" → "vector" 변경
- 파일 패턴 변경 없음 (상대경로)

**5b. .gitignore**
- `plugin/` 항목 제거 (이제 `packages/plugin/` 내부에서 관리)
- `dist/` → `packages/*/dist/` 패턴
- `packages/web/dist/` 추가

**5c. .env.example**
- DB 이름: `obsidiansync` → `vector` (선택적, 사용자 결정)

**5d. CLAUDE.md, README.md**
- 프로젝트명 "obsidian-sync-db" → "vector" 변경

### Step 6: 정리

- 루트의 기존 `src/`, `tests/`, `dist/` 삭제
- 루트의 기존 `tsconfig.json` → 삭제 (tsconfig.base.json으로 대체)
- 루트의 기존 `vitest.config.ts` → 삭제 (vitest.workspace.ts으로 대체)
- 루트의 기존 `eslint.config.js` → 삭제 (각 패키지에서 개별 관리)
- 루트의 기존 `drizzle.config.ts` → 삭제 (packages/server/로 이관 완료)
- `_reference/` 디렉토리 유지 또는 삭제 (사용자 확인)

## Files Modified/Created Summary

| 카테고리 | 파일수 | 액션 |
|---------|--------|------|
| 루트 설정 (신규) | 3 | package.json, tsconfig.base.json, vitest.workspace.ts |
| 서버 이관 | ~15 | src/ + tests/ 이관, 설정 4개 신규 |
| 플러그인 이관 | ~25 | plugin/ → packages/plugin/ 이동, 설정 수정 |
| 웹 스캐폴드 | 5 | 신규 생성 |
| 공유 설정 | 4 | eslint, gitignore, env, CLAUDE.md |
| 삭제 | 5 | 루트의 기존 설정 파일 |

**총 관여 파일**: ~55개 (대부분 mv)

## Verification

1. `npm install` - 워크스페이스 의존성 설치 확인
2. `npm run build -w packages/server` - 서버 빌드 성공
3. `npm run build -w packages/plugin` - 플러그인 빌드 성공 (main.js 생성)
4. `npm run build -w packages/web` - 웹 빌드 성공
5. `npm run test -ws` - 전체 테스트 통과
6. `npm run lint -ws` - ESLint 통과
7. `npm run dev -w packages/server` - 서버 정상 기동
8. `npm run generate:all` - OpenAPI 타입 생성 정상
