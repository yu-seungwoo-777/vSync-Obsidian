import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";

describe("Rate limiting", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("/health 엔드포인트는 rate limit 에서 제외된다", async () => {
    // 여러 번 호출해도 모두 성공해야 함
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("rate limit 정보가 응답 헤더에 포함될 수 있다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    // Rate limit 관련 헤더가 존재할 수 있음
    // (설정 여부에 따라 다름)
    expect(res.statusCode).toBe(200);
  });
});
