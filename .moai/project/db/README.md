# .moai/project/db/

Vector — Obsidian 동기화 서버의 데이터베이스 스키마 문서.

---

## Database Profile

| 항목 | 값 |
|------|------|
| Engine | PostgreSQL |
| ORM | Drizzle ORM v0.42.0 |
| Migration Tool | Drizzle Kit v0.31.0 |
| Multi-tenant | 단일 스키마 (vault_id FK) |
| Schema Definition | `packages/server/src/db/schemas/` |
| Migration Files | `packages/server/src/db/migrations/` |
| Drizzle Config | `packages/server/drizzle.config.ts` |

---

## Auto-sync Policy

| Trigger | Action |
|---------|--------|
| Migration file saved (matches `migration_patterns` in `db.yaml`) | `moai-domain-db-docs` regenerates `schema.md` and `erd.mmd` |
| Files in `.moai/project/db/**` saved | **Excluded** — no recursive trigger |
| Files in `.moai/cache/**` saved | Excluded |
| `**/*.lock` files saved | Excluded |

Debounce: 10 seconds (configurable via `db.auto_sync.debounce_seconds` in `db.yaml`).
User approval required before applying auto-generated changes (`require_user_approval: true`).

---

## Update Workflow

```
1. Edit migration file (e.g., packages/server/src/db/schemas/*.ts)
2. Run: cd packages/server && npm run db:generate
3. PostToolUse hook fires → moai-domain-db-docs analyzes changes
4. Proposed updates presented via AskUserQuestion
5. On approval: schema.md and erd.mmd are updated
6. Manual review: rls-policies.md, queries.md, seed-data.md (not auto-updated)
```

---

## File Responsibilities

| File | Purpose | Auto-updated? |
|------|---------|---------------|
| `schema.md` | 테이블/컬럼/관계/인덱스/제약조건 | Yes (via hook) |
| `erd.mmd` | Mermaid ER 다이어그램 | Yes (via hook) |
| `migrations.md` | 마이그레이션 이력 및 롤백 노트 | Partial (applied list) |
| `rls-policies.md` | Row-level security 정책 | No — edit manually |
| `queries.md` | 주요 쿼리 패턴 | No — edit manually |
| `seed-data.md` | 시드 데이터 전략 | No — edit manually |

---

## Configuration

Database documentation behavior is controlled by `.moai/config/sections/db.yaml`.

Key settings:
- `db.enabled` — `true` (auto-sync 활성화)
- `db.engine` — `postgresql`
- `db.orm` — `drizzle`
- `db.migration_tool` — `drizzle-kit`
- `db.multi_tenant` — `single_schema`

---

_Last reviewed: 2026-04-23_
_Populated by: `/moai db init`_
