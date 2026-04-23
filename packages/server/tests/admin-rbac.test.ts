import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials, vaults } from "../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { createAdminVault, createTestVault } from "./setup.js";

function extractCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((c: string) => c.split(";")[0]).join("; ");
}

describe("SPEC-RBAC-001: Vault RBAC", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();

  // admin 계정
  const adminUsername = `rbac-admin-${Date.now()}`;
  const adminPassword = "rbacadmin12345678";
  let adminCookies: string;
  let adminId: string;

  // user 계정
  const userUsername = `rbac-user-${Date.now()}`;
  const userPassword = "rbacuser12345678";
  let userCookies: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildTestAdminApp();

    // admin 계정 생성
    const adminHash = await bcrypt.hash(adminPassword, 12);
    const adminResult = await db
      .insert(adminCredentials)
      .values({ username: adminUsername, passwordHash: adminHash, role: "admin" })
      .returning();
    adminId = adminResult[0].id;

    // user 계정 생성
    const userHash = await bcrypt.hash(userPassword, 12);
    const userResult = await db
      .insert(adminCredentials)
      .values({ username: userUsername, passwordHash: userHash, role: "user" })
      .returning();
    userId = userResult[0].id;

    // admin 로그인
    const adminLoginRes = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: adminUsername, password: adminPassword },
    });
    adminCookies = extractCookies(adminLoginRes.headers["set-cookie"]);

    // user 로그인
    const userLoginRes = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: userUsername, password: userPassword },
    });
    userCookies = extractCookies(userLoginRes.headers["set-cookie"]);
  });

  afterAll(async () => {
    // admin 계정이 생성한 볼트를 먼저 삭제 (외래 키 제약 때문)
    try {
      const adminVaults = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.createdBy, adminId));
      for (const v of adminVaults) {
        await db.delete(vaults).where(eq(vaults.id, v.id));
      }
      const userVaults = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.createdBy, userId));
      for (const v of userVaults) {
        await db.delete(vaults).where(eq(vaults.id, v.id));
      }
    } catch {
      // 무시
    }
    await db.delete(adminCredentials).where(eq(adminCredentials.username, adminUsername));
    await db.delete(adminCredentials).where(eq(adminCredentials.username, userUsername));
    await app.close();
    await client.end();
  });

  describe("T-008a: POST /vaults created_by 저장 (AC-005)", () => {
    it("admin이 볼트 생성 시 created_by에 adminId가 저장된다", async () => {
      const body = await createAdminVault(app, "admin-created-vault", adminCookies);

      // DB에서 created_by 확인
      const result = await db
        .select()
        .from(vaults)
        .where(eq(vaults.id, body.id));

      expect(result[0].createdBy).toBe(adminId);
    });

    it("user가 볼트 생성 시 created_by에 userId가 저장된다", async () => {
      const body = await createAdminVault(app, "user-created-vault", userCookies);

      // DB에서 created_by 확인
      const result = await db
        .select()
        .from(vaults)
        .where(eq(vaults.id, body.id));

      expect(result[0].createdBy).toBe(userId);
    });
  });

  describe("T-008b/c/d: GET /vaults 접근 제어 (AC-007~009)", () => {
    let adminVaultId: string;
    let userVaultId: string;
    let legacyVaultId: string;

    beforeAll(async () => {
      // admin이 볼트 생성
      const adminVaultRes = await createAdminVault(app, "admin-list-vault", adminCookies);
      adminVaultId = adminVaultRes.id;

      // user가 볼트 생성
      const userVaultRes = await createAdminVault(app, "user-list-vault", userCookies);
      userVaultId = userVaultRes.id;

      // v1 API로 볼트 생성 (created_by=NULL)
      const legacyRes = await createTestVault(app, "legacy-vault");
      legacyVaultId = legacyRes.vault_id;
    });

    it("admin 롤은 전체 볼트를 조회한다 (AC-007)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/vaults",
        headers: { cookie: adminCookies },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.map((v: { id: string }) => v.id);
      expect(ids).toContain(adminVaultId);
      expect(ids).toContain(userVaultId);
      expect(ids).toContain(legacyVaultId);
    });

    it("user 롤은 본인 볼트만 조회한다 (AC-008)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/vaults",
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.map((v: { id: string }) => v.id);
      expect(ids).toContain(userVaultId);
      expect(ids).not.toContain(adminVaultId);
    });

    it("user 롤에 created_by=NULL 볼트는 미표시된다 (AC-009)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/vaults",
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.map((v: { id: string }) => v.id);
      expect(ids).not.toContain(legacyVaultId);
    });
  });

  describe("T-008e/f/g: DELETE 권한 (AC-010~012)", () => {
    it("admin 롤은 모든 볼트를 삭제할 수 있다 (AC-010)", async () => {
      // user가 볼트 생성
      const vaultRes = await createAdminVault(app, "user-vault-to-delete-by-admin", userCookies);
      const vaultId = vaultRes.id;

      // admin이 삭제
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: adminCookies },
      });

      expect(res.statusCode).toBe(204);
    });

    it("user 롤은 본인 볼트를 삭제할 수 있다 (AC-011)", async () => {
      // user가 볼트 생성
      const vaultRes = await createAdminVault(app, "user-own-vault-to-delete", userCookies);
      const vaultId = vaultRes.id;

      // user가 삭제
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(204);
    });

    it("user 롤이 타인 볼트 삭제 시 403을 반환한다 (AC-012)", async () => {
      // admin이 볼트 생성
      const vaultRes = await createAdminVault(app, "admin-vault-delete-forbidden", adminCookies);
      const vaultId = vaultRes.id;

      // user가 삭제 시도
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("T-008h/i/j: Delete 권한 (AC-013~015)", () => {
    it("admin 롤은 모든 볼트를 삭제할 수 있다 (AC-013)", async () => {
      // user가 볼트 생성
      const vaultRes = await createAdminVault(app, "user-vault-del-by-admin", userCookies);
      const vaultId = vaultRes.id;

      // admin이 삭제
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: adminCookies },
      });

      expect(res.statusCode).toBe(204);
    });

    it("user 롤은 본인 볼트를 삭제할 수 있다 (AC-014)", async () => {
      // user가 볼트 생성
      const vaultRes = await createAdminVault(app, "user-own-delete", userCookies);
      const vaultId = vaultRes.id;

      // user가 삭제
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(204);
    });

    it("user 롤이 타인 볼트 삭제 시 403을 반환한다 (AC-015)", async () => {
      // admin이 볼트 생성
      const vaultRes = await createAdminVault(app, "admin-vault-delete-forbidden", adminCookies);
      const vaultId = vaultRes.id;

      // user가 삭제 시도
      const res = await app.inject({
        method: "DELETE",
        url: `/admin/api/vaults/${vaultId}`,
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /me role 확인 (AC-016, AC-017)", () => {
    it("admin 로그인 시 /me에서 role='admin'을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/me",
        headers: { cookie: adminCookies },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe("admin");
    });

    it("user 로그인 시 /me에서 role='user'를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/me",
        headers: { cookie: userCookies },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe("user");
    });
  });
});
