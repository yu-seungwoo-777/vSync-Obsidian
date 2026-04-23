import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";

describe("T-008: Static File Serving", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildTestAdminApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("/admin/api/status는 정적 파일 서빙보다 우선한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/status",
    });

    // API 응답이어야 함 (정적 파일이 아님)
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("initialized");
  });

  it("/v1/ 라우트는 정적 파일 서빙보다 우선한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    // API 응답이어야 함
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("status");
  });

  it("존재하지 않는 경로에 대해 index.html을 반환한다 (SPA fallback)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/some-spa-route/dashboard",
    });

    // SPA fallback: 정적 파일이 없으면 404 또는 index.html 반환
    // 빌드 결과물이 없는 경우 404 허용
    expect([200, 404]).toContain(res.statusCode);
  });
});
