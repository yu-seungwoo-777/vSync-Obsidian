import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials } from "../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { createTestVault } from "./setup.js";
import { generateToken } from "../src/services/jwt.js";

describe("Auth + Vault API", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const testUsername = `auth-test-${Date.now()}`;
  const testPassword = "authtest12345678";
  let jwtToken: string;
  let testAdminId: string;

  beforeAll(async () => {
    app = await buildApp();

    // 테스트용 관리자 계정 생성
    const hash = await bcrypt.hash(testPassword, 12);
    const [inserted] = await db.insert(adminCredentials).values({
      username: testUsername,
      passwordHash: hash,
      role: "admin",
    }).returning();
    testAdminId = inserted.id;

    // JWT 토큰 획득 (device_id 포함)
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: testUsername, password: testPassword, device_id: "test-device" },
    });
    jwtToken = loginRes.json().token;
  });

  afterAll(async () => {
    // 테스트용 관리자 계정 정리
    const { adminCredentials: ac } = await import("../src/db/schemas/index.js");
    await db.delete(ac).where(eq(ac.username, testUsername));
    await app.close();
    await client.end();
  });

  describe("POST /v1/vault - 볼트 생성", () => {
    it("이름으로 볼트를 생성하면 vault_id를 반환한다", async () => {
      const vault = await createTestVault(app, "test-vault");

      expect(vault.vault_id).toBeDefined();
      expect(typeof vault.vault_id).toBe("string");
    });

    it("이름이 없으면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/vault",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("인증 미들웨어", () => {
    let test_vault_id: string;

    // 테스트용 볼트 생성
    beforeAll(async () => {
      const vault = await createTestVault(app, "auth-test-vault");
      test_vault_id = vault.vault_id;
    });

    it("Authorization 헤더가 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Unauthorized");
    });

    it("잘못된 JWT 토큰이면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
        headers: { authorization: "Bearer invalid-token-12345" },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid or expired token");
    });

    it("유효한 JWT 토큰과 올바른 device_id면 200을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
        headers: {
          authorization: `Bearer ${jwtToken}`,
          "x-device-id": "test-device",
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // SPEC-JWT-DEVICE-BINDING-001: device_id 검증 (REQ-DB-004, REQ-DB-009)
  describe("device_id 검증 미들웨어", () => {
    let test_vault_id: string;

    beforeAll(async () => {
      const vault = await createTestVault(app, "device-bind-test-vault");
      test_vault_id = vault.vault_id;
    });

    it("JWT의 device_id와 X-Device-ID 헤더가 일치하면 200을 반환한다 (REQ-DB-004)", async () => {
      const token = generateToken({
        user_id: "admin-id",
        username: testUsername,
        role: "admin",
        device_id: "device-abc",
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-device-id": "device-abc",
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it("JWT의 device_id와 X-Device-ID 헤더가 다르면 401을 반환한다 (REQ-DB-009)", async () => {
      const token = generateToken({
        user_id: "admin-id",
        username: testUsername,
        role: "admin",
        device_id: "device-abc",
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-device-id": "device-xyz",
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Device identity mismatch");
    });

    it("X-Device-ID 헤더가 없으면 401을 반환한다 (REQ-DB-004)", async () => {
      const token = generateToken({
        user_id: "admin-id",
        username: testUsername,
        role: "admin",
        device_id: "device-abc",
      });

      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Missing device identity");
    });

    it("관리자 역할도 device_id 검증에서 예외가 없다 (REQ-DB-004)", async () => {
      const token = generateToken({
        user_id: "admin-id",
        username: testUsername,
        role: "admin",
        device_id: "admin-device",
      });

      // 다른 device_id로 요청
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${test_vault_id}/files`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-device-id": "other-device",
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Device identity mismatch");
    });
  });
});
