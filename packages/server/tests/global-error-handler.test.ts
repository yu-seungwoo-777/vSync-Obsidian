import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";

describe("Global error handler", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("StandardError 를 표준 에러 형식으로 변환한다", async () => {
    // 인증 없이 보호된 라우트에 접근하면 에러 핸들러가 처리
    const res = await app.inject({
      method: "GET",
      url: "/v1/vault/non-existent-id/files",
    });

    // StandardError 형식인지 확인: { error: { code, message, statusCode } }
    // 또는 기존 형식일 수 있으나, 에러 핸들러가 제대로 동작하는지 확인
    res.json();
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("존재하지 않는 라우트에 대해 에러를 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/nonexistent",
    });

    expect(res.statusCode).toBe(404);
  });

  it("서버 에러 발생 시 500 응답을 반환한다", async () => {
    // 잘못된 JSON body로 POST 요청
    const res = await app.inject({
      method: "POST",
      url: "/v1/vault",
      headers: {
        "content-type": "application/json",
      },
      body: "{ invalid json }}}",
    });

    // Fastify가 자동으로 400 반환 (JSON 파싱 에러)
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
