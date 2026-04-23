import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { exportVault, exportToDirectory } from "../src/services/export.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders } from "./helpers/jwt-auth.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Export Service", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "export-test-vault");
    vault_id = vault.vault_id;
    

    // 테스트용 파일 3개 업로드 (1개는 삭제)
    const headers = { ...authHeaders(jwt_token) };
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/a.md", content: "# File A", hash: "hash-a" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/b.md", content: "# File B", hash: "hash-b" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/c.md", content: "# File C", hash: "hash-c" },
    });

    // c.md 삭제
    await app.inject({
      method: "DELETE",
      url: `/v1/vault/${vault_id}/file/notes/c.md`,
      headers,
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  describe("exportVault", () => {
    it("활성 파일만 반환한다 (삭제된 파일 제외)", async () => {
      const result = await exportVault(db, vault_id);

      expect(result.length).toBe(2);
      const paths = result.map((f) => f.path);
      expect(paths).toContain("notes/a.md");
      expect(paths).toContain("notes/b.md");
      expect(paths).not.toContain("notes/c.md");
    });

    it("각 파일에 path, content, hash를 포함한다", async () => {
      const result = await exportVault(db, vault_id);

      const file_a = result.find((f) => f.path === "notes/a.md");
      expect(file_a).toBeDefined();
      expect(file_a!.content).toBe("# File A");
      expect(file_a!.hash).toBe("hash-a");
    });
  });

  describe("exportToDirectory", () => {
    it("디렉토리에 마크다운 파일을 생성한다", async () => {
      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-test-"));

      try {
        await exportToDirectory(db, vault_id, tmp_dir);

        // 파일 존재 확인
        expect(fs.existsSync(path.join(tmp_dir, "notes", "a.md"))).toBe(true);
        expect(fs.existsSync(path.join(tmp_dir, "notes", "b.md"))).toBe(true);

        // 삭제된 파일은 존재하지 않아야 함
        expect(fs.existsSync(path.join(tmp_dir, "notes", "c.md"))).toBe(false);

        // 내용 확인
        const content = fs.readFileSync(
          path.join(tmp_dir, "notes", "a.md"),
          "utf-8",
        );
        expect(content).toBe("# File A");
      } finally {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
      }
    });

    it("빈 볼트는 빈 디렉토리를 생성한다", async () => {
      // 빈 볼트 생성
      const empty_vault = await createTestVault(app, "empty-export-vault");
      const empty_vault_id = empty_vault.vault_id;

      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-empty-"));

      try {
        await exportToDirectory(db, empty_vault_id, tmp_dir);

        // notes 디렉토리가 존재하지 않아야 함
        expect(fs.existsSync(path.join(tmp_dir, "notes"))).toBe(false);
      } finally {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
      }
    });
  });
});
