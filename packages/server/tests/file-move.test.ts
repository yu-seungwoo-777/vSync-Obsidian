import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("File move", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "file-move-test");
    vault_id = vault.vault_id;
    

    // 이동할 파일 생성
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/raw/move/source.md`,
      headers: { ...authHeaders(jwt_token),
        "content-type": "text/markdown",
      },
      body: "# Source File\nContent to be moved",
    });

    // 충돌 테스트용 대상 파일 미리 생성
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/raw/move/existing-target.md`,
      headers: { ...authHeaders(jwt_token),
        "content-type": "text/markdown",
      },
      body: "# Existing Target",
    });
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
      url: `/v1/vault/${vault_id}/move`,
      payload: { from: "a.md", to: "b.md" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("파일을 이동하면 200 을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/move`,
      headers: auth_headers(),
      payload: {
        from: "move/source.md",
        to: "move/destination.md",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("path");
  });

  it("이동 후 원본 경로에 파일이 없다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/raw/move/source.md`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(404);
  });

  it("이동 후 대상 경로에 파일이 존재한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/raw/move/destination.md`,
      headers: authHeaders(jwt_token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Source File");
  });

  it("존재하지 않는 파일 이동 시 404 를 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/move`,
      headers: auth_headers(),
      payload: {
        from: "nonexistent/file.md",
        to: "target/file.md",
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("from 이 없으면 400 을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/move`,
      headers: auth_headers(),
      payload: { to: "target/file.md" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("to 가 없으면 400 을 반환한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/move`,
      headers: auth_headers(),
      payload: { from: "source/file.md" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("대상 경로에 이미 파일이 있으면 409 를 반환한다", async () => {
    // 충돌 테스트를 위해 새 소스 파일 생성
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/raw/move/conflict-source.md`,
      headers: { ...authHeaders(jwt_token),
        "content-type": "text/markdown",
      },
      body: "# Conflict Source",
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/vault/${vault_id}/move`,
      headers: auth_headers(),
      payload: {
        from: "move/conflict-source.md",
        to: "move/existing-target.md",
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body).toHaveProperty("error");
  });
});
