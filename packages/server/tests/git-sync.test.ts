import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { exportToDirectory } from "../src/services/export.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Git Sync", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "git-sync-test-vault");
    vault_id = vault.vault_id;
    

    // 테스트 파일 업로드
    const headers = { ...authHeaders(jwt_token) };
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/git-a.md", content: "# Git A", hash: "git-hash-a" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/git-b.md", content: "# Git B", hash: "git-hash-b" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/git-c.md", content: "# Git C", hash: "git-hash-c" },
    });

    // c.md 삭제
    await app.inject({
      method: "DELETE",
      url: `/v1/vault/${vault_id}/file/notes/git-c.md`,
      headers,
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  describe("exportToDirectory + git commit", () => {
    it("디렉토리에 활성 파일만 생성한다", async () => {
      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-test-"));

      try {
        await exportToDirectory(db, vault_id, tmp_dir);

        // 파일 존재 확인
        expect(fs.existsSync(path.join(tmp_dir, "notes", "git-a.md"))).toBe(true);
        expect(fs.existsSync(path.join(tmp_dir, "notes", "git-b.md"))).toBe(true);
        // 삭제된 파일은 존재하지 않아야 함
        expect(fs.existsSync(path.join(tmp_dir, "notes", "git-c.md"))).toBe(false);

        // 내용 확인
        const content_a = fs.readFileSync(
          path.join(tmp_dir, "notes", "git-a.md"),
          "utf-8",
        );
        expect(content_a).toBe("# Git A");
      } finally {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
      }
    });

    it("git add + commit이 정상 실행된다", async () => {
      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-commit-"));

      try {
        // Git 초기화
        execSync("git init", { cwd: tmp_dir });
        execSync('git config user.email "test@test.com"', { cwd: tmp_dir });
        execSync('git config user.name "Test"', { cwd: tmp_dir });

        // 파일 내보내기
        await exportToDirectory(db, vault_id, tmp_dir);

        // git add + commit
        execSync("git add -A", { cwd: tmp_dir });
        execSync(`git commit -m "sync: vault ${vault_id} - 2 files"`, {
          cwd: tmp_dir,
        });

        // commit 존재 확인
        const log = execSync("git log --oneline", {
          cwd: tmp_dir,
          encoding: "utf-8",
        });
        expect(log).toContain("sync:");
      } finally {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
      }
    });

    it("변경 없으면 commit이 실패하지 않는다", async () => {
      const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-sync-nochange-"));

      try {
        execSync("git init", { cwd: tmp_dir });
        execSync('git config user.email "test@test.com"', { cwd: tmp_dir });
        execSync('git config user.name "Test"', { cwd: tmp_dir });

        await exportToDirectory(db, vault_id, tmp_dir);

        // 첫 번째 commit
        execSync("git add -A", { cwd: tmp_dir });
        execSync(`git commit -m "sync: first"`, { cwd: tmp_dir });

        // 동일 내용으로 다시 add (변경 없음)
        execSync("git add -A", { cwd: tmp_dir });

        // commit은 실패하지만 에러가 발생하지 않아야 함
        try {
          execSync(`git commit -m "sync: second"`, { cwd: tmp_dir });
        } catch {
          // nothing to commit - 정상 동작
        }

        // 첫 번째 commit은 존재해야 함
        const log = execSync("git log --oneline", {
          cwd: tmp_dir,
          encoding: "utf-8",
        });
        expect(log).toContain("sync: first");
      } finally {
        fs.rmSync(tmp_dir, { recursive: true, force: true });
      }
    });
  });
});
