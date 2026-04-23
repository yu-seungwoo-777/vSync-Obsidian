import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";

describe("CORS 환경 변수 제어", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("CORS preflight 요청에 응답한다", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
      },
    });

    // CORS 활성화 상태 확인 (204 또는 200)
    expect(res.statusCode).toBeLessThanOrEqual(204);
  });

  it("응답에 CORS 헤더가 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        origin: "http://localhost:3000",
      },
    });

    // CORS 헤더가 존재하는지 확인
    const access_control = res.headers["access-control-allow-origin"];
    expect(access_control).toBeDefined();
  });
});
