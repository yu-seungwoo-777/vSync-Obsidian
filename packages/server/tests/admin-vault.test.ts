import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials, vaults } from "../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

// set-cookie 헤더에서 쿠키 문자열만 추출
function extractCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((c: string) => c.split(";")[0]).join("; ");
}

describe("T-006: Vault Admin Routes", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const adminUsername = `vault-admin-${Date.now()}`;
  const adminPassword = "vaultadmin12345678";
  let sessionCookies: string;
  const createdVaultIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestAdminApp();
    // 관리자 계정 생성
    const hash = await bcrypt.hash(adminPassword, 12);
    await db.insert(adminCredentials).values({
      username: adminUsername,
      passwordHash: hash,
      role: "admin",
    });

    // 로그인하여 세션 획득
    const loginRes = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: adminUsername, password: adminPassword },
    });
    sessionCookies = extractCookies(loginRes.headers["set-cookie"]);
  });

  afterAll(async () => {
    // 볼트 삭제 (cascade로 files, sync_events, device_sync_state도 삭제됨)
    for (const vaultId of createdVaultIds) {
      await db.delete(vaults).where(eq(vaults.id, vaultId));
    }
    await db
      .delete(adminCredentials)
      .where(eq(adminCredentials.username, adminUsername));
    await app.close();
    await client.end();
  });

  describe("POST /admin/api/vaults", () => {
    it("새 볼트를 생성하고 id, name을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/vaults",
        payload: { name: "admin-test-vault" },
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe("admin-test-vault");
      // API key는 더 이상 반환하지 않음
      expect(body.api_key).toBeUndefined();
      createdVaultIds.push(body.id);
    });

    it("이름이 없으면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/vaults",
        payload: {},
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(400);
    });

    it("미인증 상태에서 401을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/vaults",
        payload: { name: "unauth-vault" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /admin/api/vaults", () => {
    it("모든 볼트 목록을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/vaults",
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);

      if (body.length > 0) {
        const vault = body[0];
        expect(vault.id).toBeDefined();
        expect(vault.name).toBeDefined();
        expect(vault.created_at).toBeDefined();
        // API key 관련 필드는 더 이상 포함하지 않음
        expect(vault.api_key).toBeUndefined();
        expect(vault.api_key_hash).toBeUndefined();
      }
    });

    it("미인증 상태에서 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/vaults",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("DELETE /admin/api/vaults/:id", () => {
    let vaultId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/api/vaults",
        payload: { name: "delete-test-vault" },
        headers: { cookie: sessionCookies },
      });
      vaultId = res.json().id;
      createdVaultIds.push(vaultId);
    });

    it("볼트를 삭제한다", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(204);

      // 목록에서 제거됨 (createdVaultIds에서도 제거하여 afterAll 에러 방지)
      const idx = createdVaultIds.indexOf(vaultId);
      if (idx >= 0) createdVaultIds.splice(idx, 1);
    });

    it("존재하지 않는 볼트면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/admin/api/vaults/00000000-0000-0000-0000-000000000000",
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
