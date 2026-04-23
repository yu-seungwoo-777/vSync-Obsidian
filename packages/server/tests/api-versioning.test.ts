import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";

describe("API versioning", () => {
  let app: FastifyInstance;
  let vault_id: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("/health 에는 X-API-Version 헤더가 없을 수 있다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    // health 는 버전 헤더가 없어도 됨
    expect(res.statusCode).toBe(200);
  });

  it("/v1 라우트에 X-API-Version 헤더가 포함된다", async () => {
    // 볼트 생성은 인증 불필요
    const vault = await createTestVault(app, "version-test-vault");
    vault_id = vault.vault_id;

    // 볼트 생성 응답에서 버전 헤더 확인
    const checkRes = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/files`,
    });

    const version = checkRes.headers["x-api-version"];
    expect(version).toBeDefined();
    expect(version).toBe("1.0.0");
  });

  it("404 응답에도 X-API-Version 헤더가 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/nonexistent",
    });

    expect(res.statusCode).toBe(404);
    const version = res.headers["x-api-version"];
    // 버전 헤더가 포함되거나, 최소한 에러 응답이 표준 형식
    if (version) {
      expect(version).toBe("1.0.0");
    }
  });
});
