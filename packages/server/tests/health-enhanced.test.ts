import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";

describe("Enhanced /health 엔드포인트", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("200 응답과 함께 상태 정보를 반환한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // 기본 상태 필드 확인
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("timestamp");
  });

  it("database 상태를 포함한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body = res.json();
    expect(body).toHaveProperty("database");
    expect(["ok", "error"]).toContain(body.database);
  });

  it("storage 상태를 포함한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body = res.json();
    expect(body).toHaveProperty("storage");
    expect(["ok", "error"]).toContain(body.storage);
  });

  it("websocket 상태를 포함한다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body = res.json();
    expect(body).toHaveProperty("websocket");
    expect(["ok", "error"]).toContain(body.websocket);
  });

  it("인증 없이 접근할 수 있다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    // X-Api-Key 헤더 없이도 200 반환
    expect(res.statusCode).toBe(200);
  });

  it("모든 컴포넌트가 정상이면 status 는 ok 이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body = res.json();
    if (body.database === "ok" && body.storage === "ok" && body.websocket === "ok") {
      expect(body.status).toBe("ok");
    }
  });

  it("timestamp 가 ISO 8601 형식이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const body = res.json();
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
