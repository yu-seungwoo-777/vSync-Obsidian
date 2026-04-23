import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders } from "./helpers/jwt-auth.js";

describe("Export API Route", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "export-api-test-vault");
    vault_id = vault.vault_id;
    

    // 테스트 파일 업로드
    const headers = { ...authHeaders(jwt_token) };
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/export-a.md", content: "# Export A", hash: "exp-hash-a" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/export-b.md", content: "# Export B", hash: "exp-hash-b" },
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("GET /v1/vault/:id/export - 볼트 전체 덤프", () => {
    it("볼트의 모든 활성 파일을 JSON으로 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/export`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.files).toBeDefined();
      expect(Array.isArray(body.files)).toBe(true);
      expect(body.files.length).toBe(2);

      const paths = body.files.map((f: any) => f.path);
      expect(paths).toContain("notes/export-a.md");
      expect(paths).toContain("notes/export-b.md");
    });

    it("각 파일에 path, content, hash를 포함한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/export`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const file_a = body.files.find((f: any) => f.path === "notes/export-a.md");

      expect(file_a).toBeDefined();
      expect(file_a.content).toBe("# Export A");
      expect(file_a.hash).toBe("exp-hash-a");
    });

    it("빈 볼트는 빈 배열을 반환한다", async () => {
      const empty_vault = await createTestVault(app, "empty-export-api-vault");
      const empty_vault_id = empty_vault.vault_id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${empty_vault_id}/export`,
        headers: authHeaders(jwt_token),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().files).toEqual([]);
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/export`,
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
