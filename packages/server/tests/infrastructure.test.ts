import { describe, it, expect, afterAll } from "vitest";
import { createDbClient } from "../src/config/database.js";
import { createS3Client, ensureBucket, storageConfig } from "../src/config/storage.js";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";

describe("PostgreSQL 연결", () => {
  const { client, db } = createDbClient();

  afterAll(async () => {
    await client.end();
  });

  it("DB에 연결할 수 있다", async () => {
    const result = await db.execute(sql`SELECT 1 as value`);
    expect(result[0].value).toBe(1);
  });

  it("pg_trgm 확장이 설치되어 있다", async () => {
    const result = await db.execute(
      sql`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
    );
    expect(result.length).toBe(1);
    expect(result[0].extname).toBe("pg_trgm");
  });

  it("스키마 테이블이 존재한다", async () => {
    const result = await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const tables = result.map((r) => r.tablename);
    expect(tables).toContain("vaults");
    expect(tables).toContain("files");
    expect(tables).toContain("file_versions");
    expect(tables).toContain("sync_events");
    expect(tables).toContain("device_sync_state");
  });
});

describe("MinIO 연결", () => {
  const s3 = createS3Client();

  it("S3 호환 엔드포인트에 연결할 수 있다", async () => {
    const result = await s3.send(new HeadBucketCommand({ Bucket: storageConfig.bucket }));
    expect(result.$metadata.httpStatusCode).toBe(200);
  });

  it("vaults 버킷이 존재한다", async () => {
    await expect(
      s3.send(new HeadBucketCommand({ Bucket: storageConfig.bucket })),
    ).resolves.toBeDefined();
  });

  it("ensure_bucket이 이미 존재하는 버킷에 대해 정상 동작한다", async () => {
    await expect(ensureBucket(s3)).resolves.toBeUndefined();
  });
});

describe("스키마 - SPEC-P1-STORAGE-002", () => {
  const { client, db } = createDbClient();

  afterAll(async () => {
    await client.end();
  });

  it("files 테이블에 content, fileType 컬럼이 존재한다", async () => {
    const result = await db.execute(
      sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'files' AND column_name IN ('content', 'file_type')`
    );
    expect(result.length).toBe(2);
  });

  it("files.fileType 기본값은 markdown이다", async () => {
    const result = await db.execute(
      sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'files' AND column_name = 'file_type'`
    );
    expect(result.length).toBe(1);
    expect(result[0].column_default).toContain("markdown");
  });

  it("file_versions 테이블에 content 컬럼이 존재한다", async () => {
    const result = await db.execute(
      sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'file_versions' AND column_name = 'content'`
    );
    expect(result.length).toBe(1);
    expect(result[0].is_nullable).toBe("YES");
  });
});

// ─── SPEC-P5-3WAY-001: 3-Way Merge 스키마 검증 ──────────
describe("스키마 - SPEC-P5-3WAY-001 (T-001)", () => {
  const { client, db } = createDbClient();

  afterAll(async () => {
    await client.end();
  });

  it("file_versions에 base_version_id 컬럼이 존재한다", async () => {
    const result = await db.execute(
      sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'file_versions' AND column_name = 'base_version_id'`
    );
    expect(result.length).toBe(1);
    expect(result[0].data_type).toBe("uuid");
    expect(result[0].is_nullable).toBe("YES");
  });

  it("file_versions에 merge_type 컬럼이 존재한다", async () => {
    const result = await db.execute(
      sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'file_versions' AND column_name = 'merge_type'`
    );
    expect(result.length).toBe(1);
    expect(result[0].data_type).toBe("text");
    expect(result[0].is_nullable).toBe("NO");
    expect(result[0].column_default).toContain("normal");
  });

  it("merge_type CHECK 제약조건으로 유효하지 않은 값이 거부된다", async () => {
    await expect(
      db.execute(sql`INSERT INTO file_versions (id, file_id, version_num, storage_key, content_hash, merge_type) VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'test', 'test', 'invalid_type')`)
    ).rejects.toThrow();
  });

  it("merge_type 기본값은 normal이다", async () => {
    // 기존 데이터 중 merge_type이 설정된 것 확인
    const result = await db.execute(
      sql`SELECT merge_type FROM file_versions LIMIT 1`
    );
    if (result.length > 0) {
      expect(result[0].merge_type).toBe("normal");
    }
    // 기본값 확인
    const default_result = await db.execute(
      sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'file_versions' AND column_name = 'merge_type'`
    );
    expect(default_result[0].column_default).toContain("normal");
  });
});
