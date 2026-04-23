// SPEC-JWT-DEVICE-BINDING-001: login route device_id 처리 (REQ-DB-003)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials } from "../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "vsync-jwt-secret-change-in-production";

describe("POST /v1/auth/login - device_id 바인딩 (REQ-DB-003)", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const testUsername = `login-test-${Date.now()}`;
  const testPassword = "logintest12345678";

  beforeAll(async () => {
    app = await buildApp();

    const hash = await bcrypt.hash(testPassword, 12);
    await db.insert(adminCredentials).values({
      username: testUsername,
      passwordHash: hash,
      role: "admin",
    });
  });

  afterAll(async () => {
    await db.delete(adminCredentials).where(eq(adminCredentials.username, testUsername));
    await app.close();
    await client.end();
  });

  it("device_id와 함께 로그인하면 토큰에 device_id가 포함되어야 한다 (REQ-DB-003)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: testUsername,
        password: testPassword,
        device_id: "my-phone-device",
      },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.token).toBeDefined();

    // 토큰 디코딩으로 device_id 확인
    const decoded = jwt.verify(body.token, JWT_SECRET) as Record<string, unknown>;
    expect(decoded.device_id).toBe("my-phone-device");
  });

  it("device_id 없이 로그인하면 400 에러를 반환해야 한다 (REQ-DB-003)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: testUsername,
        password: testPassword,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("device_id");
  });

  it("빈 device_id로 로그인하면 400 에러를 반환해야 한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: testUsername,
        password: testPassword,
        device_id: "",
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("로그인 응답에 user 정보와 vaults 목록이 포함되어야 한다", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        username: testUsername,
        password: testPassword,
        device_id: "test-device-1",
      },
    });

    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.username).toBe(testUsername);
    expect(body.vaults).toBeDefined();
    expect(Array.isArray(body.vaults)).toBe(true);
  });
});
