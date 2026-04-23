// @MX:NOTE 충돌 감지 및 해결 통합 테스트 (SPEC-P5-CONFLICT-001)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files, conflicts } from "../src/db/schemas/index.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("SPEC-P5-CONFLICT-001 - 충돌 감지 및 해결", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);
    // 테스트용 볼트 생성
    const vault = await createTestVault(app, "conflict-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  // 헬퍼: 인증 헤더
  const auth_headers = () => authHeaders(jwt_token);

  // ─── REQ-P5-001: 서버 측 충돌 감지 ─────────────────────

  describe("REQ-P5-001 - base_hash 충돌 감지 (PUT /vault/:id/file)", () => {
    it("base_hash가 서버 해시와 일치하면 정상 업데이트된다", async () => {
      // 파일 업로드
      const upload_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/test.md",
          content: "# Original",
          hash: "hash-original-v1",
        },
      });
      expect(upload_res.statusCode).toBe(200);

      // base_hash 일치 → 정상 업데이트
      const update_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/test.md",
          content: "# Updated",
          hash: "hash-updated-v2",
          base_hash: "hash-original-v1",
        },
      });
      expect(update_res.statusCode).toBe(200);
      expect(update_res.json().hash).toBe("hash-updated-v2");
    });

    it("base_hash가 서버 해시와 다르면 409 Conflict를 반환한다", async () => {
      // 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/clash.md",
          content: "# Server Version",
          hash: "server-hash-v1",
        },
      });

      // 다른 클라이언트가 이미 업데이트한 상황 시뮬레이션
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/clash.md",
          content: "# Server Version 2",
          hash: "server-hash-v2",
        },
      });

      // 오래된 base_hash로 업데이트 시도 → 충돌
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/clash.md",
          content: "# Client Version",
          hash: "client-hash-v1",
          base_hash: "server-hash-v1", // 오래된 해시
        },
      });

      expect(conflict_res.statusCode).toBe(409);
      const body = conflict_res.json();
      expect(body.conflict).toBe(true);
      expect(body.current_hash).toBe("server-hash-v2");
      expect(body.incoming_hash).toBe("client-hash-v1");
      expect(body.conflict_path).toContain("sync-conflict");
    });

    it("base_hash가 없으면 기존 동작대로 무조건 업데이트한다", async () => {
      // 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/no-base.md",
          content: "# First",
          hash: "no-base-v1",
        },
      });

      // base_hash 없이 업데이트 → 무조건 성공
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/no-base.md",
          content: "# Second",
          hash: "no-base-v2",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().hash).toBe("no-base-v2");
    });

    it("새 파일에 base_hash를 보내도 정상 생성된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/new-file.md",
          content: "# New File",
          hash: "new-file-hash",
          base_hash: "nonexistent-hash",
        },
      });

      // 기존 파일이 없으므로 충돌 불가 → 정상 생성
      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe(1);
    });
  });

  // ─── REQ-P5-001: Raw PUT X-Base-Hash 헤더 ────────────────

  describe("REQ-P5-001 - Raw PUT X-Base-Hash 충돌 감지", () => {
    it("X-Base-Hash 헤더가 서버 해시와 다르면 409 Conflict를 반환한다", async () => {
      // Raw PUT으로 파일 생성
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/conflict-test/raw-clash.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "# Raw Original",
      });

      // Raw PUT으로 업데이트 (서버 해시 변경)
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/conflict-test/raw-clash.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "# Raw Updated",
      });

      // 오래된 해시로 충돌 유발
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/conflict-test/raw-clash.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
          "x-base-hash": "wrong-hash-value",
        },
        body: "# Client Attempt",
      });

      expect(conflict_res.statusCode).toBe(409);
      expect(conflict_res.json().conflict).toBe(true);
    });

    it("X-Base-Hash 헤더가 서버 해시와 일치하면 정상 업데이트된다", async () => {
      // Raw PUT으로 파일 생성
      const create_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/conflict-test/raw-ok.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "# Raw Create",
      });
      expect(create_res.statusCode).toBe(200);

      const current_hash = create_res.json().hash;

      // 같은 해시로 업데이트 → 정상
      const update_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/conflict-test/raw-ok.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
          "x-base-hash": current_hash,
        },
        body: "# Raw Updated OK",
      });
      expect(update_res.statusCode).toBe(200);
    });
  });

  // ─── REQ-P5-002: 충돌 파일 자동 생성 ────────────────────

  describe("REQ-P5-002 - 충돌 파일 자동 생성", () => {
    it("충돌 시 .sync-conflict- 파일이 생성된다", async () => {
      // 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/auto-create.md",
          content: "# Server",
          hash: "auto-v1",
        },
      });

      // 서버에서 업데이트
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/auto-create.md",
          content: "# Server v2",
          hash: "auto-v2",
        },
      });

      // 충돌 유발
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/auto-create.md",
          content: "# Client v1",
          hash: "client-auto-v1",
          base_hash: "auto-v1",
        },
      });
      expect(conflict_res.statusCode).toBe(409);

      const conflict_path = conflict_res.json().conflict_path;
      expect(conflict_path).toMatch(/auto-create\.sync-conflict-\d+\.md/);

      // 충돌 파일이 DB에 존재하는지 확인
      const conflict_files = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.vaultId, vault_id),
            eq(files.path, conflict_path),
          ),
        );
      expect(conflict_files.length).toBe(1);
      expect(conflict_files[0].content).toBe("# Client v1");
      expect(conflict_files[0].fileType).toBe("conflict");
    });

    it("충돌 시 conflicts 테이블에 기록이 생성된다", async () => {
      // 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/db-record.md",
          content: "# Original",
          hash: "db-v1",
        },
      });

      // 업데이트하여 서버 해시 변경
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/db-record.md",
          content: "# Updated Server",
          hash: "db-v2",
        },
      });

      // 충돌 유발
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/db-record.md",
          content: "# Client Content",
          hash: "client-db-v1",
          base_hash: "db-v1",
        },
      });
      expect(res.statusCode).toBe(409);

      // conflicts 테이블 확인
      const conflict_records = await db
        .select()
        .from(conflicts)
        .where(eq(conflicts.vaultId, vault_id));

      // 최신 충돌 기록 확인
      const latest_conflict = conflict_records[conflict_records.length - 1];
      expect(latest_conflict).toBeDefined();
      expect(latest_conflict.conflictPath).toContain("db-record.sync-conflict-");
      expect(latest_conflict.incomingHash).toBe("client-db-v1");
      expect(latest_conflict.resolvedAt).toBeNull();
    });
  });

  // ─── REQ-P5-003: 충돌 목록 API ──────────────────────────

  describe("REQ-P5-003 - GET /vault/:id/conflicts", () => {
    it("미해결 충돌 목록을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.conflicts)).toBe(true);
      expect(body.conflicts.length).toBeGreaterThanOrEqual(1);

      // 첫 번째 충돌 검증
      const first_conflict = body.conflicts[0];
      expect(first_conflict.id).toBeDefined();
      expect(first_conflict.original_path).toBeDefined();
      expect(first_conflict.conflict_path).toContain("sync-conflict");
      expect(first_conflict.created_at).toBeDefined();
    });

    it("인증 없이 요청하면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── REQ-P5-004: 충돌 해결 API ──────────────────────────

  describe("REQ-P5-004 - POST /vault/:id/conflicts/:conflictId/resolve", () => {
    it("resolution=accept: 원본을 충돌 파일 내용으로 덮어쓴다", async () => {
      // 파일 업로드 + 충돌 생성
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/resolve-accept.md",
          content: "# Server",
          hash: "resolve-accept-v1",
        },
      });
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/resolve-accept.md",
          content: "# Server v2",
          hash: "resolve-accept-v2",
        },
      });
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/resolve-accept.md",
          content: "# Client Accepted",
          hash: "resolve-accept-client",
          base_hash: "resolve-accept-v1",
        },
      });
      expect(conflict_res.statusCode).toBe(409);

      // 충돌 목록에서 ID 획득
      const list_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
        headers: auth_headers(),
      });
      const conflict_list = list_res.json().conflicts;
      const target_conflict = conflict_list.find(
        (c: any) => c.conflict_path.includes("resolve-accept"),
      );
      expect(target_conflict).toBeDefined();

      // accept 해결
      const resolve_res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/conflicts/${target_conflict.id}/resolve`,
        headers: auth_headers(),
        payload: { resolution: "accept" },
      });

      expect(resolve_res.statusCode).toBe(200);
      expect(resolve_res.json().resolution).toBe("accept");

      // 원본 파일이 충돌 내용으로 변경되었는지 확인
      const file_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/conflict-test/resolve-accept.md`,
        headers: auth_headers(),
      });
      expect(file_res.json().content).toBe("# Client Accepted");

      // resolved_at이 설정되었는지 확인
      const db_conflict = await db
        .select()
        .from(conflicts)
        .where(eq(conflicts.id, target_conflict.id));
      expect(db_conflict[0].resolvedAt).not.toBeNull();
      expect(db_conflict[0].resolution).toBe("accept");
    });

    it("resolution=reject: 충돌 파일을 삭제하고 원본을 유지한다", async () => {
      // 파일 업로드 + 충돌 생성
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/resolve-reject.md",
          content: "# Server Kept",
          hash: "reject-v1",
        },
      });
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/resolve-reject.md",
          content: "# Server v2",
          hash: "reject-v2",
        },
      });
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/resolve-reject.md",
          content: "# Client Rejected",
          hash: "reject-client",
          base_hash: "reject-v1",
        },
      });
      expect(conflict_res.statusCode).toBe(409);

      const conflict_path = conflict_res.json().conflict_path;

      // 충돌 ID 획득
      const list_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
        headers: auth_headers(),
      });
      const target_conflict = list_res.json().conflicts.find(
        (c: any) => c.conflict_path.includes("resolve-reject"),
      );
      expect(target_conflict).toBeDefined();

      // reject 해결
      const resolve_res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/conflicts/${target_conflict.id}/resolve`,
        headers: auth_headers(),
        payload: { resolution: "reject" },
      });

      expect(resolve_res.statusCode).toBe(200);
      expect(resolve_res.json().resolution).toBe("reject");

      // 원본 파일 유지 확인
      const file_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/conflict-test/resolve-reject.md`,
        headers: auth_headers(),
      });
      expect(file_res.json().content).toBe("# Server v2");

      // 충돌 파일이 소프트 삭제되었는지 확인
      const conflict_files = await db
        .select()
        .from(files)
        .where(
          and(
            eq(files.vaultId, vault_id),
            eq(files.path, conflict_path),
          ),
        );
      expect(conflict_files[0].deletedAt).not.toBeNull();
    });

    it("이미 해결된 충돌을 다시 해결하면 404를 반환한다", async () => {
      // DB에서 이미 해결된 충돌 조회
      const resolved_conflicts = await db
        .select()
        .from(conflicts)
        .where(eq(conflicts.vaultId, vault_id));

      const resolved = resolved_conflicts.find((c) => c.resolvedAt !== null);
      if (resolved) {
        const res = await app.inject({
          method: "POST",
          url: `/v1/vault/${vault_id}/conflicts/${resolved.id}/resolve`,
          headers: auth_headers(),
          payload: { resolution: "accept" },
        });
        expect(res.statusCode).toBe(404);
      }
    });

    it("존재하지 않는 충돌 ID면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/conflicts/00000000-0000-0000-0000-000000000000/resolve`,
        headers: auth_headers(),
        payload: { resolution: "accept" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("잘못된 resolution 값이면 400을 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/conflicts/00000000-0000-0000-0000-000000000000/resolve`,
        headers: auth_headers(),
        payload: { resolution: "invalid" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── 엣지 케이스 ─────────────────────────────────────

  describe("엣지 케이스", () => {
    it("삭제된 파일에 base_hash를 보내면 정상 동작한다", async () => {
      // 파일 생성 후 삭제
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/deleted-file.md",
          content: "# To Delete",
          hash: "deleted-v1",
        },
      });
      await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/file/conflict-test/deleted-file.md`,
        headers: auth_headers(),
      });

      // 삭제된 파일에 base_hash와 함께 업로드 → 복원 + 업데이트
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "conflict-test/deleted-file.md",
          content: "# Restored",
          hash: "restored-v1",
          base_hash: "deleted-v1",
        },
      });
      // 파일이 삭제되었으므로 해시 비교 후 복원 처리
      expect(res.statusCode).toBe(200);
    });

    it("해결된 충돌은 목록에 나타나지 않는다", async () => {
      // 충돌 목록 조회
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
        headers: auth_headers(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // 모든 항목이 미해결 상태인지 확인
      for (const c of body.conflicts) {
        const db_record = await db
          .select()
          .from(conflicts)
          .where(eq(conflicts.id, c.id));
        expect(db_record[0].resolvedAt).toBeNull();
      }
    });
  });

  // ─── SPEC-P5-3WAY-001: 3-Way 자동 병합 (T-003) ──────────

  describe("SPEC-P5-3WAY-001 - 3-Way 자동 병합", () => {
    it("다른 줄 수정 시 자동 병합되어 200 응답 + auto_merged 필드를 반환한다", async () => {
      // 파일 v1 업로드
      const v1_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/auto-merge.md",
          content: "line1\nline2\nline3",
          hash: "auto-v1",
        },
      });
      expect(v1_res.statusCode).toBe(200);

      // 파일 v2 업로드 (서버에서 업데이트 - line1 수정)
      const v2_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/auto-merge.md",
          content: "LINE1\nline2\nline3",
          hash: "auto-v2",
        },
      });
      expect(v2_res.statusCode).toBe(200);

      // 클라이언트가 v1 기반으로 line3 수정 후 업로드 → 자동 병합 기대
      const merge_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/auto-merge.md",
          content: "line1\nline2\nLINE3",
          hash: "auto-v3-merged",
          base_hash: "auto-v1",
        },
      });

      expect(merge_res.statusCode).toBe(200);
      const body = merge_res.json();
      expect(body.auto_merged).toBe(true);
      expect(body.merge_type).toBe("auto");

      // 병합 결과 확인
      const file_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/3way-test/auto-merge.md`,
        headers: auth_headers(),
      });
      expect(file_res.json().content).toContain("LINE1");
      expect(file_res.json().content).toContain("LINE3");
    });

    it("같은 줄 수정 시 409 응답에 base_hash, diff, can_auto_merge 필드가 포함된다", async () => {
      // 파일 v1 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/same-line.md",
          content: "line1\nline2\nline3",
          hash: "same-v1",
        },
      });

      // 서버 업데이트 (line2 수정)
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/same-line.md",
          content: "line1\nSERVER_LINE2\nline3",
          hash: "same-v2",
        },
      });

      // 클라이언트도 line2 수정 → 충돌
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/same-line.md",
          content: "line1\nCLIENT_LINE2\nline3",
          hash: "same-v3",
          base_hash: "same-v1",
        },
      });

      expect(conflict_res.statusCode).toBe(409);
      const body = conflict_res.json();
      expect(body.conflict).toBe(true);
      expect(body.base_hash).toBe("same-v1");
      expect(body.can_auto_merge).toBe(false);
      expect(Array.isArray(body.diff)).toBe(true);
      expect(body.diff.length).toBeGreaterThan(0);
    });

    it("base_hash가 제공되지 않으면 기존 동작이 유지된다", async () => {
      // 파일 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/no-base-hash.md",
          content: "original",
          hash: "nobase-v1",
        },
      });

      // base_hash 없이 업데이트 → 기존대로 성공
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/no-base-hash.md",
          content: "updated",
          hash: "nobase-v2",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().hash).toBe("nobase-v2");
    });

    it("base_version_id가 새 버전에 올바르게 저장된다", async () => {
      // 파일 v1 업로드
      const v1_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/base-version.md",
          content: "version 1",
          hash: "bv-v1",
        },
      });
      expect(v1_res.statusCode).toBe(200);

      // 파일 v2 업로드 (base_version_id 확인)
      const v2_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "3way-test/base-version.md",
          content: "version 2",
          hash: "bv-v2",
          base_hash: "bv-v1",
        },
      });
      expect(v2_res.statusCode).toBe(200);

      // DB에서 base_version_id 확인
      const { fileVersions } = await import("../src/db/schemas/index.js");
      const versions = await db
        .select({
          id: fileVersions.id,
          version_num: fileVersions.versionNum,
          base_version_id: fileVersions.baseVersionId,
          merge_type: fileVersions.mergeType,
        })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, v1_res.json().id))
        .orderBy(fileVersions.versionNum);

      // v1은 base_version_id가 null
      expect(versions[0].base_version_id).toBeNull();
      // v2의 base_version_id는 v1의 id
      if (versions.length >= 2) {
        expect(versions[1].base_version_id).toBe(versions[0].id);
      }
    });
  });

  // ─── SPEC-P5-3WAY-001: merge-resolve (T-004, T-005) ──────────

  describe("SPEC-P5-3WAY-001 - merge-resolve + base-content", () => {
    it("merge-resolve: 유효한 충돌 ID로 병합 해결 시 200을 반환한다", async () => {
      // 파일 v1 업로드
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "resolve-test/merge-resolve.md",
          content: "line1\nline2\nline3",
          hash: "mr-v1",
        },
      });

      // 서버 업데이트
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "resolve-test/merge-resolve.md",
          content: "line1\nSERVER\nline3",
          hash: "mr-v2",
        },
      });

      // 충돌 발생
      const conflict_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "resolve-test/merge-resolve.md",
          content: "line1\nCLIENT\nline3",
          hash: "mr-v3",
          base_hash: "mr-v1",
        },
      });
      expect(conflict_res.statusCode).toBe(409);

      // 충돌 ID 획득
      const list_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/conflicts`,
        headers: auth_headers(),
      });
      const target_conflict = list_res.json().conflicts.find(
        (c: any) => c.conflict_path.includes("merge-resolve"),
      );
      expect(target_conflict).toBeDefined();

      // merge-resolve 호출
      const resolve_res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/conflicts/${target_conflict.id}/merge-resolve`,
        headers: auth_headers(),
        payload: {
          content: "line1\nMERGED\nline3",
          hash: "mr-merged",
        },
      });

      expect(resolve_res.statusCode).toBe(200);
      expect(resolve_res.json().resolvedAt).toBeDefined();

      // 원본 파일이 병합 결과로 업데이트되었는지 확인
      const file_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/resolve-test/merge-resolve.md`,
        headers: auth_headers(),
      });
      expect(file_res.json().content).toBe("line1\nMERGED\nline3");
    });

    it("merge-resolve: 존재하지 않는 충돌 ID면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/conflicts/00000000-0000-0000-0000-000000000000/merge-resolve`,
        headers: auth_headers(),
        payload: {
          content: "merged content",
          hash: "merged-hash",
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it("GET base-content: base_hash로 버전 내용을 조회할 수 있다", async () => {
      // 파일 v1 업로드
      const v1_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "resolve-test/base-content.md",
          content: "base content here",
          hash: "bc-v1",
        },
      });
      expect(v1_res.statusCode).toBe(200);

      // base content 조회 (?base=hash 쿼리 파라미터)
      const base_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/resolve-test/base-content.md?base=bc-v1`,
        headers: auth_headers(),
      });

      expect(base_res.statusCode).toBe(200);
      expect(base_res.json().content).toBe("base content here");
      expect(base_res.json().hash).toBe("bc-v1");
    });

    it("GET base-content: 존재하지 않는 hash면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/file/resolve-test/base-content.md?base=nonexistent-hash`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
