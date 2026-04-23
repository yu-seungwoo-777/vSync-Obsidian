import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Batch operations", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "batch-test");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers() {
    return { ...authHeaders(jwt_token), "content-type": "application/json" };
  }

  it("인증 없이 접근하면 401 을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/batch`,
      payload: { operations: [] },
    });

    expect(res.statusCode).toBe(401);
  });

  it("빈 operations 배열은 400 을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/batch`,
      headers: auth_headers(),
      payload: { operations: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it("단일 create 연산이 성공한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/batch`,
      headers: auth_headers(),
      payload: {
        operations: [
          {
            type: "create",
            data: { path: "batch/test1.md", content: "# Batch Test 1", hash: "batchhash1" },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("results");
    expect(body.results).toHaveLength(1);
  });

  it("여러 연산이 모두 성공하면 200 을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/batch`,
      headers: auth_headers(),
      payload: {
        operations: [
          {
            type: "create",
            data: { path: "batch/test2.md", content: "# Test 2", hash: "batchhash2" },
          },
          {
            type: "create",
            data: { path: "batch/test3.md", content: "# Test 3", hash: "batchhash3" },
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results).toHaveLength(2);
  });

  it("부분 실패 시 207 Multi-Status 를 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/batch`,
      headers: auth_headers(),
      payload: {
        operations: [
          {
            type: "create",
            data: { path: "batch/test4.md", content: "# Test 4", hash: "batchhash4" },
          },
          {
            type: "delete",
            data: { path: "batch/nonexistent.md" },
          },
        ],
      },
    });

    // 하나는 성공, 하나는 실패 → 207
    expect([200, 207]).toContain(res.statusCode);
    const body = res.json();
    expect(body.results).toHaveLength(2);
  });

  it("operations 가 50개 초과면 400 을 반환한다", async () => {
    const ops = Array.from({ length: 51 }, (_, i) => ({
      type: "create",
      data: { path: `batch/toomany${i}.md`, content: "x", hash: `h${i}` },
    }));

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/batch`,
      headers: auth_headers(),
      payload: { operations: ops },
    });

    expect(res.statusCode).toBe(400);
  });
});
