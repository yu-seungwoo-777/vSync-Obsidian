# Migrations

Vector 서버 — Drizzle Kit 마이그레이션 이력.

---

## Applied Migrations

| Filename | Applied At | Summary |
|----------|-----------|---------|
| 0000_typical_grey_gargoyle.sql | 초기 | 초기 스키마: vaults, files, file_versions, sync_events, device_sync_state 5개 테이블 생성 |
| 0001_pg_trgm_search.sql | 초기 | pg_trgm 확장 활성화, files.content GIN 트라이그램 인덱스 생성 |
| 0002_cool_maelstrom.sql | 초기 | conflicts 테이블 생성, file_versions.content / files.content / files.file_type 컬럼 추가 |
| 0003_three_way_merge.sql | 초기 | file_versions에 base_version_id, merge_type 컬럼 추가 (3-Way Auto Merge) |
| 0004_event_sequence.sql | 초기 | sync_events에 sequence (BIGSERIAL) 컬럼 및 (vault_id, sequence) 인덱스 추가 |
| 0005_woozy_tyger_tiger.sql | 초기 | admin_credentials 테이블 생성, vaults에 api_key_preview 컬럼 추가 |
| 0006_low_iron_patriot.sql | 초기 | admin_credentials에 role 컬럼 추가, vaults에 api_key, created_by FK 추가 |
| 0007_common_hellion.sql | 초기 | sync_events에 from_path 컬럼 추가, vaults에서 api_key_hash/api_key/api_key_preview 삭제 (JWT 전환) |

---

## Migration Notes

### API Key 제거 이력

- 0005: vaults에 `api_key_preview` 추가
- 0006: vaults에 `api_key` 추가
- 0007: vaults에서 `api_key_hash`, `api_key`, `api_key_preview` 모두 삭제 (JWT 인증으로 전환)

### Breaking Changes

- 0007에서 API Key 관련 컬럼 3개가 삭제됨 → 기존 API Key 기반 인증 코드는 동작 불가
- JWT device_id 바인딩으로 전환 완료 (SPEC-JWT-DEVICE-BINDING-001)

---

## Rollback Notes

| Migration | Risk Level | Rollback Steps | Data Loss? |
|-----------|-----------|----------------|------------|
| 0007_common_hellion | High | api_key_hash/api_key/api_key_preview 복원 불가 (삭제됨) | YES |
| 0006_low_iron_patriot | Low | ALTER TABLE admin_credentials DROP COLUMN role; ALTER TABLE vaults DROP COLUMN api_key, DROP COLUMN created_by | No |
| 0005_woozy_tyger_tiger | Medium | DROP TABLE admin_credentials; ALTER TABLE vaults DROP COLUMN api_key_preview | YES (관리자 계정) |
| 0004_event_sequence | Low | ALTER TABLE sync_events DROP COLUMN sequence; DROP INDEX idx_sync_events_vault_seq | No |
| 0003_three_way_merge | Medium | ALTER TABLE file_versions DROP COLUMN base_version_id, DROP COLUMN merge_type | No |
| 0002_cool_maelstrom | High | DROP TABLE conflicts; 컬럼 3개 삭제 | YES (충돌 이력) |
| 0001_pg_trgm_search | Low | DROP INDEX files_content_trgm_idx; DROP EXTENSION pg_trgm | No |
| 0000_initial | Critical | 전체 스키마 DROP | YES (전체) |
