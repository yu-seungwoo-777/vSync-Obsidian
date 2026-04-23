import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files } from "../src/db/schemas/index.js";
import { setupTestAuth, authHeaders } from "./helpers/jwt-auth.js";
import { createTestVault } from "./setup.js";

// REQ-SRV-002 + REQ-SRV-003: 트랜잭션 래핑 + upsert 경쟁 상태 테스트
describe("uploadFile 트랜잭션 및 upsert (REQ-SRV-002, REQ-SRV-003)", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "transaction-test-vault");
    vault_id = vault.vault_id;
  });

  afterAll(async () => {
    // 볼트는 setup.ts에서 자동 삭제
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("REQ-SRV-002: 트랜잭션 래핑", () => {
    it("3-way merge 자동 병합이 정상 수행되면 버전 3이 생성된다", async () => {
      // 1) 파일 업로드 (버전 1) - base
      const contentV1 = "# 원본\n\n줄 A\n줄 B\n줄 C";
      const hashV1 = "tx-merge-v1-hash";
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "tx/merge-test.md", content: contentV1, hash: hashV1 },
      });

      // 2) 서버 측 업데이트 (버전 2) - 줄 B를 수정 (baseHash 없이)
      const contentV2 = "# 원본\n\n줄 A\n줄 B (수정됨)\n줄 C";
      const hashV2 = "tx-merge-v2-hash";
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: { path: "tx/merge-test.md", content: contentV2, hash: hashV2 },
      });

      // 3) baseHash=V1으로 다른 줄 수정 → 자동 병합 가능 (다른 줄 변경)
      const contentV3 = "# 원본\n\n줄 A (클라이언트 수정)\n줄 B\n줄 C";
      const hashV3 = "tx-merge-v3-hash";
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "tx/merge-test.md",
          content: contentV3,
          hash: hashV3,
          base_hash: hashV1,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // 자동 병합 성공
      expect(body.conflict).toBeUndefined();
      expect(body.version).toBe(3);
      expect(body.auto_merged).toBe(true);
    });
  });

  describe("REQ-SRV-003: 업로드 경쟁 상태 (upsert)", () => {
    it("동일 (vault, path)에 동시 업로드해도 중복 레코드가 발생하지 않는다", async () => {
      // 동시에 여러 요청을 보내어 경쟁 상태 유발
      const concurrentPath = "tx/concurrent-test.md";
      const promises = Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: "PUT",
          url: `/v1/vault/${vault_id}/file`,
          headers: auth_headers(),
          payload: {
            path: concurrentPath,
            content: `# 동시 업로드 ${i}`,
            hash: `concurrent-hash-${i}`,
          },
        })
      );

      const results = await Promise.all(promises);

      // 모든 요청이 200이어야 함
      for (const res of results) {
        expect(res.statusCode).toBe(200);
      }

      // DB에 파일 레코드가 정확히 1개만 존재해야 함
      const fileRows = await db
        .select()
        .from(files)
        .where(and(eq(files.vaultId, vault_id), eq(files.path, concurrentPath)));

      expect(fileRows.length).toBe(1);
    });

    it("upsert 이후에도 파일 내용이 유효하다", async () => {
      // 동시 업로드된 파일을 GET으로 조회
      const concurrentPath = "tx/concurrent-test.md";
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/${concurrentPath}`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.path).toBe(concurrentPath);
      expect(body.hash).toBeDefined();
      expect(body.version).toBeGreaterThanOrEqual(1);
    });
  });
});
