import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";

describe("Request logging", () => {
  let app: FastifyInstance;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("응답에 X-Request-Id 헤더가 포함된다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const requestId = res.headers["x-request-id"];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe("string");
  });

  it("X-Request-Id 가 UUID 형식이다", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    const requestId = res.headers["x-request-id"];
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("요청마다 다른 X-Request-Id 가 생성된다", async () => {
    const res1 = await app.inject({ method: "GET", url: "/health" });
    const res2 = await app.inject({ method: "GET", url: "/health" });

    const id1 = res1.headers["x-request-id"];
    const id2 = res2.headers["x-request-id"];

    expect(id1).not.toBe(id2);
  });
});
