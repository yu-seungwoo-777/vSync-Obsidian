-- pg_trgm 확장 활성화: 유사도 기반 전문 검색을 위한 PostgreSQL 확장
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- files.content 컬럼에 GIN 트라이그램 인덱스 생성: 유사도 검색 성능 최적화
CREATE INDEX CONCURRENTLY IF NOT EXISTS "files_content_trgm_idx" ON "files" USING gin ("content" gin_trgm_ops);
