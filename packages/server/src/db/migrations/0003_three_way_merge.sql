-- Migration: 0003_three_way_merge
-- SPEC-P5-3WAY-001: 3-Way Auto Merge
-- Adds base_version_id and merge_type columns to file_versions table

ALTER TABLE file_versions
  ADD COLUMN base_version_id UUID REFERENCES file_versions(id) ON DELETE SET NULL,
  ADD COLUMN merge_type TEXT NOT NULL DEFAULT 'normal'
    CHECK (merge_type IN ('normal', 'auto', 'manual', 'conflict'));
