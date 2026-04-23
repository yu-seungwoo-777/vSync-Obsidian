-- Migration: 0004_event_sequence
-- SPEC-P6-EVENT-007: WS 이벤트 멱등성 및 직렬 처리
-- Adds sequence column to sync_events for cursor-based pagination

ALTER TABLE sync_events ADD COLUMN sequence BIGSERIAL;
CREATE INDEX idx_sync_events_vault_seq ON sync_events(vault_id, sequence);
