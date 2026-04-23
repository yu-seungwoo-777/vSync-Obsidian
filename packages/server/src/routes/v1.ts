import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../config/database.js";
import { createAuthMiddleware, getUserVaults } from "../services/auth.js";
import { createVault } from "../services/vault.js";
import { generateToken, verifyToken } from "../services/jwt.js";

import {
  uploadFile,
  getFile,
  deleteFile,
  listFiles,
  listVersions,
  editFile,
  listFolder,
} from "../services/file.js";
import type { ConflictResult } from "../services/file.js";
import { searchFiles } from "../services/search.js";
import { getEventsSince, updateDeviceSyncState, createSyncEvent } from "../services/sync-event.js";
import { guessContentType } from "../utils/content-type.js";
import { exportVault } from "../services/export.js";
import { uploadAttachment, getAttachment } from "../services/attachment.js";
import { listConflicts, resolveConflict, mergeResolve, getBaseContent } from "../services/conflict.js";
import { validateVaultPath, validateSize, MAX_RAW_SIZE } from "../utils/validation.js";
import { serializeUploadResult, serializeFileInfo, serializeFileDetail, serializeFolderEntry } from "../utils/serialize.js";
import { StandardError, ERROR_CODES } from "../utils/errors.js";
import {
  fileUploadSchema,
  editSchema,
  searchSchema,
  eventsQuerySchema,
  syncStatusSchema,
  batchSchema,
  moveSchema,
} from "../schemas/api-schemas.js";
import { eq, and } from "drizzle-orm";
import { deviceSyncState, files, adminCredentials } from "../db/schemas/index.js";

// 라우트 파라미터 추출 헬퍼
function getParams(request: { params: unknown }) {
  const params = request.params as Record<string, string>;
  return { vaultId: params.id, filePath: params["*"] };
}

// X-Device-ID 헤더 추출 헬퍼
function getDeviceId(request: { headers: Record<string, string | string[] | undefined> }): string {
  const value = request.headers["x-device-id"];
  return typeof value === "string" ? value : "unknown";
}

function validateFilePath(filePath: string): void {
  const result = validateVaultPath(filePath);
  if (!result.valid) {
    throw new StandardError(ERROR_CODES.VALIDATION_ERROR, result.reason, 400);
  }
}

// Zod 검증 에러를 표준 형식으로 변환
function formatZodError(error: import("zod").ZodError): string {
  return error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
}

export async function v1Routes(app: FastifyInstance) {
  const { db } = createDbClient();
  const authMiddleware = createAuthMiddleware(db);

  // 볼트 생성 (인증 불필요)
  app.post("/vault", async (request, reply) => {
    const { name } = request.body as { name?: string };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "name is required",
          statusCode: 400,
        },
      });
      return;
    }

    // REQ-API-002: 볼트 이름 길이 제한 (100자)
    if (name.length > 100) {
      reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "name must be at most 100 characters",
          statusCode: 400,
        },
      });
      return;
    }

    const vault = await createVault(db, name.trim());
    reply.code(201).send(vault);
  });

  // ─── JWT 인증 라우트 (보호된 라우트 외부) ──────────

  // @MX:NOTE ID/PW 로그인: 사용자 인증 후 JWT 토큰 발급 (device_id 포함, REQ-DB-003)
  app.post("/auth/login", async (request, reply) => {
    const { username, password, device_id: deviceId } = request.body as { username?: string; password?: string; device_id?: string };

    if (!username || !password) {
      reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "username and password are required",
          statusCode: 400,
        },
      });
      return;
    }

    // device_id 필수 검증 (REQ-DB-003)
    if (!deviceId) {
      reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "device_id is required",
          statusCode: 400,
        },
      });
      return;
    }

    // 사용자 조회
    const users = await db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.username, username))
      .limit(1);

    if (users.length === 0) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    const user = users[0];

    // bcrypt 비밀번호 검증
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      reply.code(401).send({ error: "Invalid credentials" });
      return;
    }

    // JWT 토큰 생성 (device_id 포함, REQ-DB-003)
    const token = generateToken({
      user_id: user.id,
      username: user.username,
      role: user.role,
      device_id: deviceId,
    });

    // 사용자가 접근 가능한 볼트 목록 조회
    const userVaults = await getUserVaults(db, user.id, user.role);

    reply.send({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      vaults: userVaults,
    });
  });

  // @MX:NOTE JWT 인증으로 볼트 목록 조회
  app.get("/auth/vaults", async (request, reply) => {
    const authorization = request.headers["authorization"];

    if (!authorization || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const token = authorization.slice(7);
    const payload = verifyToken(token);

    if (!payload) {
      reply.code(401).send({ error: "Invalid or expired token" });
      return;
    }

    const userVaults = await getUserVaults(db, payload.user_id, payload.role);

    reply.send({ vaults: userVaults });
  });

  // 인증이 필요한 라우트 그룹
  app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", authMiddleware);

    // text/markdown Content-Type 파서 등록
    protectedApp.addContentTypeParser(
      "text/markdown",
      { parseAs: "string" },
      (_req, body, done) => {
        // @MX:NOTE Raw PUT 본문 크기 제한 (10MB)
        if (typeof body === "string" && body.length > MAX_RAW_SIZE) {
          done(new Error("Payload too large"), undefined);
          return;
        }
        done(null, body);
      },
    );

    // 바이너리 Content-Type 파서 등록 (첨부파일 업로드용)
    protectedApp.addContentTypeParser(
      ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp", "application/pdf", "application/octet-stream"],
      { parseAs: "buffer" },
      (_req, body, done) => {
        done(null, body);
      },
    );

    // @MX:NOTE Raw 마크다운 업로드: SHA-256 자동 계산, PG에 직접 저장
    protectedApp.put("/vault/:id/raw/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);
      const deviceId = getDeviceId(request);
      const body = request.body as string;

      // T-C01: 경로 검증
      validateFilePath(filePath);

      // T-C02: 크기 검증
      const sizeCheck = validateSize("raw", body.length);
      if (!sizeCheck.valid) {
        reply.code(413).send({
          error: {
            code: ERROR_CODES.PAYLOAD_TOO_LARGE,
            message: sizeCheck.reason,
            statusCode: 413,
          },
        });
        return;
      }

      // @MX:NOTE X-Base-Hash 헤더: 충돌 감지용 클라이언트 해시
      const baseHash = request.headers["x-base-hash"] as string | undefined;

      // SHA-256 해시 자동 계산
      const contentHash = crypto
        .createHash("sha256")
        .update(body)
        .digest("hex");

      const result = await uploadFile(
        db,
        vaultId,
        filePath,
        body,
        contentHash,
        deviceId,
        undefined,
        baseHash,
      );

      // @MX:NOTE 충돌 감지 시 409 Conflict 반환
      if ("conflict" in result) {
        const conflict = result as ConflictResult;
        const response409: Record<string, unknown> = {
          conflict: true,
          current_hash: conflict.currentHash,
          incoming_hash: conflict.incomingHash,
          conflict_path: conflict.conflictPath,
        };
        // @MX:NOTE 3-way merge 실패 시 diff 데이터 포함 (SPEC-P5-3WAY-001)
        if (conflict.baseHash) response409.base_hash = conflict.baseHash;
        if (conflict.diff) response409.diff = conflict.diff;
        if (conflict.canAutoMerge === false) response409.can_auto_merge = false;
        reply.code(409).send(response409);
        return;
      }

      reply.send(serializeUploadResult(result));
    });

    // @MX:NOTE Raw 마크다운 조회: text/markdown으로 원본 반환
    protectedApp.get("/vault/:id/raw/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);

      // T-C01: 경로 검증
      validateFilePath(filePath);

      const result = await getFile(db, vaultId, filePath);

      if (!result) {
        reply.code(404).send({
          error: {
            code: ERROR_CODES.NOT_FOUND,
            message: "File not found",
            statusCode: 404,
          },
        });
        return;
      }

      reply
        .header("Content-Type", "text/markdown; charset=utf-8")
        .send(result.content);
    });

    // 파일 업로드/수정
    protectedApp.put("/vault/:id/file", async (request, reply) => {
      // T-C03: Zod 스키마 검증
      const parseResult = fileUploadSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const { path, content, hash } = parseResult.data;

      // T-C01: body 의 path 에 대한 경로 검증
      validateFilePath(path);
      const { vaultId } = getParams(request);

      const result = await uploadFile(
        db,
        vaultId,
        path,
        content ?? "",
        hash,
        getDeviceId(request),
        undefined,
        request.body as Record<string, string> && "base_hash" in (request.body as Record<string, string>) ? (request.body as Record<string, string>).base_hash : undefined,
      );

      // @MX:NOTE 충돌 감지 시 409 Conflict 반환 (SPEC-P5-3WAY-001 확장)
      if ("conflict" in result) {
        const conflict = result as ConflictResult;
        const response409: Record<string, unknown> = {
          conflict: true,
          current_hash: conflict.currentHash,
          incoming_hash: conflict.incomingHash,
          conflict_path: conflict.conflictPath,
        };
        if (conflict.baseHash) response409.base_hash = conflict.baseHash;
        if (conflict.diff) response409.diff = conflict.diff;
        if (conflict.canAutoMerge === false) response409.can_auto_merge = false;
        reply.code(409).send(response409);
        return;
      }

      reply.send(serializeUploadResult(result));
    });

    // 파일 내용 조회 (와일드카드 경로)
    // @MX:NOTE ?base=hash 파라미터 시 base 버전 내용 반환 (SPEC-P5-3WAY-001)
    protectedApp.get("/vault/:id/file/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);
      const query = request.query as Record<string, string>;

      // T-C01: 경로 검증
      validateFilePath(filePath);

      // base 쿼리 파라미터: 특정 해시의 버전 내용 조회
      if (query.base) {
        const result = await getBaseContent(db, vaultId, filePath, query.base);
        if (!result) {
          reply.code(404).send({
            error: {
              code: ERROR_CODES.NOT_FOUND,
              message: "Base version not found",
              statusCode: 404,
            },
          });
          return;
        }
        reply.send(result);
        return;
      }

      const result = await getFile(db, vaultId, filePath);

      if (!result) {
        reply.code(404).send({
          error: {
            code: ERROR_CODES.NOT_FOUND,
            message: "File not found",
            statusCode: 404,
          },
        });
        return;
      }

      reply.send(serializeFileDetail(result));
    });

    // 파일 소프트 삭제 (와일드카드 경로)
    protectedApp.delete("/vault/:id/file/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);

      // T-C01: 경로 검증
      validateFilePath(filePath);

      const result = await deleteFile(db, vaultId, filePath, getDeviceId(request));

      if (!result) {
        reply.code(404).send({
          error: {
            code: ERROR_CODES.NOT_FOUND,
            message: "File not found",
            statusCode: 404,
          },
        });
        return;
      }

      reply.send({ message: "File deleted", ...result });
    });

    // 파일 목록 조회
    protectedApp.get("/vault/:id/files", async (request, reply) => {
      const { vaultId } = getParams(request);
      const query = request.query as Record<string, string>;
      const limit = query.limit ? parseInt(query.limit, 10) : undefined;
      const result = await listFiles(db, vaultId, { limit });
      reply.send(result.map(serializeFileInfo));
    });

    // 파일 버전 목록 조회 (와일드카드 경로)
    protectedApp.get("/vault/:id/versions/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);

      // T-C01: 경로 검증
      validateFilePath(filePath);

      const result = await listVersions(db, vaultId, filePath);

      if (!result) {
        reply.code(404).send({
          error: {
            code: ERROR_CODES.NOT_FOUND,
            message: "File not found",
            statusCode: 404,
          },
        });
        return;
      }

      reply.send(result);
    });

    // @MX:NOTE 전문 검색: pg_trgm 유사도 기반, 마크다운 파일만 대상
    protectedApp.get("/vault/:id/search", async (request, reply) => {
      const { vaultId } = getParams(request);
      const query = request.query as Record<string, string>;

      // T-C03: Zod 스키마 검증
      const parseResult = searchSchema.safeParse(query);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const { q, limit, folder } = parseResult.data;

      const result = await searchFiles(db, vaultId, q.trim(), { limit, folder });
      reply.send(result);
    });

    // @MX:NOTE 파일 편집: old_text → new_text 교체, 자동 해시/버전 생성
    protectedApp.post("/vault/:id/edit", async (request, reply) => {
      const { vaultId } = getParams(request);

      // T-C03: Zod 스키마 검증
      const parseResult = editSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const { path, old_text: oldText, new_text: newText } = parseResult.data;

      // T-C01: body 의 path 에 대한 경로 검증
      validateFilePath(path);

      // T-C02: 편집 크기 검증
      const sizeCheck = validateSize("edit", oldText.length);
      if (!sizeCheck.valid) {
        reply.code(413).send({
          error: {
            code: ERROR_CODES.PAYLOAD_TOO_LARGE,
            message: sizeCheck.reason,
            statusCode: 413,
          },
        });
        return;
      }

      const result = await editFile(
        db,
        vaultId,
        path,
        oldText,
        newText,
        getDeviceId(request),
      );

      if (result.status) {
        reply.code(result.status).send({ error: result.error });
        return;
      }

      reply.send(result);
    });

    // @MX:NOTE 폴더 목록: 파일/하위폴더 트리 구조 반환
    protectedApp.get("/vault/:id/list", async (request, reply) => {
      const { vaultId } = getParams(request);
      const query = request.query as Record<string, string>;

      const folder = query.folder ?? "/";
      const recursive = query.recursive === "true";

      const result = await listFolder(db, vaultId, folder, recursive);
      reply.send({
        folder: result.folder,
        entries: result.entries.map(serializeFolderEntry),
      });
    });

    // @MX:NOTE 변경 폴링: since 이후 이벤트를 files 조인으로 조회
    protectedApp.get("/vault/:id/events", async (request, reply) => {
      const { vaultId } = getParams(request);
      const query = request.query as Record<string, string>;

      // T-C03: Zod 스키마 검증
      const parseResult = eventsQuerySchema.safeParse(query);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const events = await getEventsSince(db, vaultId, query.since, parseResult.data.limit);
      reply.send({ events });
    });

    // @MX:NOTE 디바이스 동기화 상태 업데이트: upsert로 커서 갱신
    protectedApp.put("/vault/:id/sync-status", async (request, reply) => {
      const { vaultId } = getParams(request);

      // T-C03: Zod 스키마 검증
      const parseResult = syncStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const { device_id: deviceId, last_event_id: lastEventId } = parseResult.data;

      const state = await updateDeviceSyncState(db, deviceId, vaultId, lastEventId);
      reply.send({
        device_id: state.deviceId,
        vault_id: state.vaultId,
        last_event_id: state.lastEventId,
        last_sync_at: state.lastSyncAt,
      });
    });

    // @MX:NOTE 볼트 전체 마크다운 덤프: LLM Wiki / 백업용 (S3 불필요)
    protectedApp.get("/vault/:id/export", async (request, reply) => {
      const { vaultId } = getParams(request);

      const exportedFiles = await exportVault(db, vaultId);
      reply.send({ files: exportedFiles });
    });

    // @MX:NOTE 첨부파일 업로드: 바이너리를 MinIO에 저장
    protectedApp.put("/vault/:id/attachment/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);
      const deviceId = getDeviceId(request);
      const body = request.body as Buffer;

      // T-C01: 경로 검증
      validateFilePath(filePath);

      // T-C02: 첨부파일 크기 검증
      const sizeCheck = validateSize("attachment", body.length);
      if (!sizeCheck.valid) {
        reply.code(413).send({
          error: {
            code: ERROR_CODES.PAYLOAD_TOO_LARGE,
            message: sizeCheck.reason,
            statusCode: 413,
          },
        });
        return;
      }

      const result = await uploadAttachment(
        db,
        vaultId,
        filePath,
        body,
        deviceId,
      );

      reply.send(result);
    });

    // @MX:NOTE 첨부파일 조회: MinIO에서 바이너리 반환
    protectedApp.get("/vault/:id/attachment/*", async (request, reply) => {
      const { vaultId, filePath } = getParams(request);

      // T-C01: 경로 검증
      validateFilePath(filePath);

      const content = await getAttachment(db, vaultId, filePath);

      if (!content) {
        reply.code(404).send({
          error: {
            code: ERROR_CODES.NOT_FOUND,
            message: "File not found",
            statusCode: 404,
          },
        });
        return;
      }

      // Content-Type 추측 (확장자 기반)
      const contentType = guessContentType(filePath);
      reply
        .header("Content-Type", contentType)
        .send(content);
    });

    // ─── SPEC-P5-CONFLICT-001: 충돌 관리 엔드포인트 ──────────

    // @MX:NOTE 미해결 충돌 목록 조회
    protectedApp.get("/vault/:id/conflicts", async (request, reply) => {
      const { vaultId } = getParams(request);
      const result = await listConflicts(db, vaultId);
      reply.send(result);
    });

    // @MX:NOTE 충돌 해결: accept(원본 덮어쓰기) 또는 reject(충돌 파일 삭제)
    protectedApp.post("/vault/:id/conflicts/:conflict_id/resolve", async (request, reply) => {
      const { vaultId } = getParams(request);
      const { conflict_id: conflictId } = request.params as { conflict_id: string };
      const { resolution } = request.body as { resolution?: string };

      // 해결 방법 검증
      if (!resolution || (resolution !== "accept" && resolution !== "reject")) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "resolution must be 'accept' or 'reject'",
            statusCode: 400,
          },
        });
        return;
      }

      const result = await resolveConflict(
        db,
        vaultId,
        conflictId,
        resolution as "accept" | "reject",
        getDeviceId(request),
      );

      if (result.status) {
        reply.code(result.status).send({ error: result.error });
        return;
      }

      reply.send(result);
    });

    // @MX:NOTE 수동 병합 해결: 모달에서 선택한 결과 저장 (SPEC-P5-3WAY-001)
    protectedApp.post("/vault/:id/conflicts/:conflict_id/merge-resolve", async (request, reply) => {
      const { vaultId } = getParams(request);
      const { conflict_id: conflictId } = request.params as { conflict_id: string };
      const { content, hash } = request.body as { content?: string; hash?: string };

      if (!content || typeof content !== "string") {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "content is required",
            statusCode: 400,
          },
        });
        return;
      }
      if (!hash || typeof hash !== "string") {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: "hash is required",
            statusCode: 400,
          },
        });
        return;
      }

      const result = await mergeResolve(
        db,
        vaultId,
        conflictId,
        content,
        hash,
        getDeviceId(request),
      );

      if ("status" in result && result.status) {
        reply.code(result.status).send({ error: result.error });
        return;
      }

      reply.send(result);
    });

    // ─── SPEC-P7-API-001: 새 엔드포인트 ──────────

    // T-E01: 디바이스 목록 조회
    protectedApp.get("/vault/:id/devices", async (request, reply) => {
      const { vaultId } = getParams(request);

      const devices = await db
        .select({
          device_id: deviceSyncState.deviceId,
          vault_id: deviceSyncState.vaultId,
          last_event_id: deviceSyncState.lastEventId,
          last_sync_at: deviceSyncState.lastSyncAt,
        })
        .from(deviceSyncState)
        .where(eq(deviceSyncState.vaultId, vaultId));

      reply.send({ devices });
    });

    // T-E02: 디바이스 삭제
    protectedApp.delete("/vault/:id/devices/:device_id", async (request, reply) => {
      const { vaultId } = getParams(request);
      const { device_id: deviceId } = request.params as { device_id: string };

      await db
        .delete(deviceSyncState)
        .where(
          and(
            eq(deviceSyncState.deviceId, deviceId),
            eq(deviceSyncState.vaultId, vaultId),
          ),
        );

      reply.send({ message: "Device removed" });
    });

    // T-E03: 배치 연산
    protectedApp.post("/vault/:id/batch", async (request, reply) => {
      const { vaultId } = getParams(request);

      // Zod 스키마 검증
      const parseResult = batchSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const { operations } = parseResult.data;
      const results: Array<{ status: number; data?: unknown; error?: string }> = [];
      let hasFailure = false;

      for (const op of operations) {
        try {
          if (op.type === "create") {
            const data = op.data as { path?: string; content?: string; hash?: string };
            if (!data.path || !data.hash) {
              results.push({ status: 400, error: "path and hash are required" });
              hasFailure = true;
              continue;
            }

            const result = await uploadFile(
              db,
              vaultId,
              data.path,
              data.content ?? "",
              data.hash,
              getDeviceId(request),
            );

            if ("conflict" in result) {
              results.push({ status: 409, error: "Conflict detected" });
              hasFailure = true;
            } else {
              results.push({ status: 200, data: serializeUploadResult(result) });
            }
          } else if (op.type === "delete") {
            const data = op.data as { path?: string };
            if (!data.path) {
              results.push({ status: 400, error: "path is required" });
              hasFailure = true;
              continue;
            }

            const result = await deleteFile(db, vaultId, data.path, getDeviceId(request));
            if (!result) {
              results.push({ status: 404, error: "File not found" });
              hasFailure = true;
            } else {
              results.push({ status: 200, data: { message: "File deleted", ...result } });
            }
          } else {
            results.push({ status: 400, error: `Unknown operation type: ${op.type}` });
            hasFailure = true;
          }
        } catch {
          results.push({ status: 500, error: "Internal error" });
          hasFailure = true;
        }
      }

      reply.code(hasFailure ? 207 : 200).send({ results });
    });

    // T-E04: 파일 이동 (rename)
    protectedApp.post("/vault/:id/move", async (request, reply) => {
      const { vaultId } = getParams(request);

      // Zod 스키마 검증
      const parseResult = moveSchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.code(400).send({
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: formatZodError(parseResult.error),
            statusCode: 400,
          },
        });
        return;
      }

      const { from, to } = parseResult.data;

      // 원본 파일 조회
      const fileRows = await db
        .select()
        .from(files)
        .where(and(eq(files.vaultId, vaultId), eq(files.path, from)))
        .limit(1);

      if (fileRows.length === 0 || fileRows[0].deletedAt) {
        reply.code(404).send({
          error: {
            code: ERROR_CODES.NOT_FOUND,
            message: "Source file not found",
            statusCode: 404,
          },
        });
        return;
      }

      const file = fileRows[0];

      // 대상 경로에 이미 파일이 존재하는지 확인
      const destRows = await db
        .select()
        .from(files)
        .where(and(eq(files.vaultId, vaultId), eq(files.path, to)))
        .limit(1);

      if (destRows.length > 0 && !destRows[0].deletedAt) {
        reply.code(409).send({
          error: {
            code: ERROR_CODES.CONFLICT,
            message: "Destination file already exists",
            statusCode: 409,
          },
        });
        return;
      }

      // 경로 업데이트
      await db
        .update(files)
        .set({ path: to, updatedAt: new Date() })
        .where(eq(files.id, file.id));

      // 동기화 이벤트: moved 타입으로 기록 (원본 경로를 fromPath에 저장)
      await createSyncEvent(db, vaultId, file.id, "moved", getDeviceId(request), from);

      reply.send({ path: to, id: file.id });
    });
  });
}