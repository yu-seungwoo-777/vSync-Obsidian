---
engine: postgresql
orm: drizzle
last_synced_at: "2026-04-23"
manifest_hash: pending
---

# Database Schema

Vector — Obsidian 동기화 서버의 PostgreSQL 스키마. Drizzle ORM v0.42.0으로 관리.

---

## Tables

| Table | Description |
|-------|-------------|
| vaults | 사용자 볼트(저장소) — 최상위 소유 단위 |
| files | 볼트 내 파일 메타데이터 (경로, 해시, 크기, 콘텐츠) |
| file_versions | 파일 버전 이력 (스토리지 키, 콘텐츠 해시, 3-way merge 지원) |
| sync_events | 동기화 이벤트 로그 (생성/수정/삭제/이동) |
| device_sync_state | 기기별 동기화 커서 (마지막 처리 이벤트 추적) |
| conflicts | 파일 충돌 이력 및 해결 상태 |
| admin_credentials | 관리자 계정 인증 정보 (username/password) |

---

## Columns

### vaults

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | PK |
| name | TEXT | NO | — | 볼트 이름 |
| created_at | TIMESTAMPTZ | NO | now() | 생성 시각 |
| updated_at | TIMESTAMPTZ | NO | now() | 수정 시각 |
| created_by | UUID | YES | — | 생성한 관리자 (FK → admin_credentials.id) |

### files

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | PK |
| vault_id | UUID | NO | — | 소속 볼트 (FK → vaults.id, ON DELETE CASCADE) |
| path | TEXT | NO | — | 파일 경로 |
| hash | TEXT | NO | — | 콘텐츠 해시 |
| size_bytes | INTEGER | YES | — | 파일 크기 |
| content | TEXT | YES | — | 파일 콘텐츠 |
| file_type | TEXT | NO | 'markdown' | 파일 타입 |
| deleted_at | TIMESTAMPTZ | YES | — | 소프트 삭제 시각 |
| created_at | TIMESTAMPTZ | NO | now() | 생성 시각 |
| updated_at | TIMESTAMPTZ | NO | now() | 수정 시각 |

### file_versions

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | PK |
| file_id | UUID | NO | — | 소속 파일 (FK → files.id, ON DELETE CASCADE) |
| version_num | INTEGER | NO | — | 버전 번호 |
| storage_key | TEXT | NO | — | 객체 스토리지 키 |
| content_hash | TEXT | NO | — | 콘텐츠 해시 |
| content | TEXT | YES | — | 버전 콘텐츠 |
| base_version_id | UUID | YES | — | 3-way merge 기준 버전 (FK → file_versions.id, ON DELETE SET NULL) |
| merge_type | TEXT | NO | 'normal' | 머지 타입 (normal, auto, manual, conflict) |
| created_at | TIMESTAMPTZ | NO | now() | 생성 시각 |

### sync_events

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | PK |
| vault_id | UUID | NO | — | 소속 볼트 (FK → vaults.id, ON DELETE CASCADE) |
| file_id | UUID | YES | — | 대상 파일 (FK → files.id, ON DELETE SET NULL) |
| event_type | TEXT | NO | — | 이벤트 타입 |
| device_id | TEXT | NO | — | 발생 기기 ID |
| from_path | TEXT | YES | — | 이동 전 경로 (moved 이벤트) |
| sequence | BIGSERIAL | YES | — | 커서 기반 페이지네이션용 시퀀스 |
| created_at | TIMESTAMPTZ | NO | now() | 생성 시각 |

### device_sync_state

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| device_id | TEXT | NO | — | 기기 ID |
| vault_id | UUID | NO | — | 소속 볼트 (FK → vaults.id, ON DELETE CASCADE) |
| last_event_id | UUID | NO | — | 마지막 처리 이벤트 ID |
| last_sync_at | TIMESTAMPTZ | NO | now() | 마지막 동기화 시각 |

### conflicts

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | PK |
| vault_id | UUID | NO | — | 소속 볼트 (FK → vaults.id, ON DELETE CASCADE) |
| file_id | UUID | YES | — | 대상 파일 (FK → files.id, ON DELETE SET NULL) |
| conflict_path | TEXT | NO | — | 충돌 파일 경로 |
| incoming_hash | TEXT | NO | — | 수신 콘텐츠 해시 |
| resolved_at | TIMESTAMPTZ | YES | — | 해결 시각 |
| resolution | TEXT | YES | — | 해결 방법 |
| created_at | TIMESTAMPTZ | NO | now() | 생성 시각 |

### admin_credentials

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | PK |
| username | VARCHAR(255) | NO | — | 관리자 ID (UNIQUE) |
| password_hash | VARCHAR(255) | NO | — | 비밀번호 해시 |
| role | VARCHAR(20) | NO | 'user' | 권한 (user/admin) |
| created_at | TIMESTAMPTZ | NO | now() | 생성 시각 |

---

## Relationships

| From | To | Cardinality | FK Column | Notes |
|------|----|-------------|-----------|-------|
| vaults | admin_credentials | N:1 | vaults.created_by → admin_credentials.id | 볼트 생성자 |
| files | vaults | N:1 | files.vault_id → vaults.id | CASCADE 삭제 |
| file_versions | files | N:1 | file_versions.file_id → files.id | CASCADE 삭제 |
| file_versions | file_versions | N:1 | file_versions.base_version_id → file_versions.id | SET NULL (자기참조) |
| sync_events | vaults | N:1 | sync_events.vault_id → vaults.id | CASCADE 삭제 |
| sync_events | files | N:1 | sync_events.file_id → files.id | SET NULL |
| device_sync_state | vaults | N:1 | device_sync_state.vault_id → vaults.id | CASCADE 삭제 |
| conflicts | vaults | N:1 | conflicts.vault_id → vaults.id | CASCADE 삭제 |
| conflicts | files | N:1 | conflicts.file_id → files.id | SET NULL |

---

## Indexes

| Table | Columns | Type | Purpose |
|-------|---------|------|---------|
| files | (vault_id, path) | UNIQUE BTREE | 볼트 내 파일 경로 유일성 |
| files | content | GIN (pg_trgm) | 유사도 기반 전문 검색 |
| sync_events | (vault_id, sequence) | BTREE | 커서 기반 이벤트 페이지네이션 |
| conflicts | vault_id | BTREE | 미해결 충돌 조회 (WHERE resolved_at IS NULL) |

---

## Constraints

| Table | Constraint | Type | Definition |
|-------|-----------|------|-----------|
| admin_credentials | admin_credentials_username_unique | UNIQUE | username 중복 방지 |
| file_versions | merge_type CHECK | CHECK | merge_type IN ('normal', 'auto', 'manual', 'conflict') |
