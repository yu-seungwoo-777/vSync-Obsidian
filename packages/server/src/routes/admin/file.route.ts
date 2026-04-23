import { eq, and, isNull } from "drizzle-orm";
import { files, vaults } from "../../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../db/schemas/index.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getAttachment } from "../../services/attachment.js";
import { guessContentType } from "../../utils/content-type.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 파일 관리자 라우트: 파일 목록 조회 및 개별 파일 콘텐츠 조회
// services/file.ts의 로직을 재사용하지만 관리자용으로 별도 구현
export function fileAdminRoutes(db: DbType) {
  return async (app: FastifyInstance) => {
    // @MX:NOTE 파일 목록 라우트: GET /vaults/:id/files
    app.get("/vaults/:id/files", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      // 볼트 존재 확인
      const vaultResult = await db
        .select({ id: vaults.id })
        .from(vaults)
        .where(eq(vaults.id, id))
        .limit(1);

      if (vaultResult.length === 0) {
        reply.code(404).send({ error: "Vault not found" });
        return;
      }

      // 삭제되지 않은 파일 목록 조회
      const result = await db
        .select({
          path: files.path,
          size: files.sizeBytes,
          updated_at: files.updatedAt,
          fileType: files.fileType,
        })
        .from(files)
        .where(and(eq(files.vaultId, id), isNull(files.deletedAt)));

      return result;
    });

    // @MX:NOTE 파일 콘텐츠 라우트: GET /vaults/:id/file/*
    // 와일드카드 경로로 파일 경로를 받아 콘텐츠 반환
    app.get("/vaults/:id/file/*", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const wildcardParam = (request.params as Record<string, string>)["*"] ?? "";
      const filePath = decodeURIComponent(wildcardParam);

      if (!filePath) {
        reply.code(400).send({ error: "File path is required" });
        return;
      }

      // 볼트 존재 확인
      const vaultResult = await db
        .select({ id: vaults.id })
        .from(vaults)
        .where(eq(vaults.id, id))
        .limit(1);

      if (vaultResult.length === 0) {
        reply.code(404).send({ error: "Vault not found" });
        return;
      }

      // 삭제되지 않은 파일 콘텐츠 조회
      const result = await db
        .select({
          path: files.path,
          content: files.content,
          size: files.sizeBytes,
          updated_at: files.updatedAt,
          fileType: files.fileType,
        })
        .from(files)
        .where(
          and(
            eq(files.vaultId, id),
            eq(files.path, filePath),
            isNull(files.deletedAt),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        reply.code(404).send({ error: "File not found" });
        return;
      }

      return result[0];
    });

    // @MX:NOTE 첨부파일 다운로드 라우트: GET /vaults/:id/attachment/*
    // 바이너리 파일(이미지, 오디오 등)을 MinIO에서 직접 반환
    app.get("/vaults/:id/attachment/*", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const wildcardParam = (request.params as Record<string, string>)["*"] ?? "";
      const filePath = decodeURIComponent(wildcardParam);

      if (!filePath) {
        reply.code(400).send({ error: "File path is required" });
        return;
      }

      // 볼트 존재 확인
      const vaultResult = await db
        .select({ id: vaults.id })
        .from(vaults)
        .where(eq(vaults.id, id))
        .limit(1);

      if (vaultResult.length === 0) {
        reply.code(404).send({ error: "Vault not found" });
        return;
      }

      // MinIO에서 바이너리 조회
      const buffer = await getAttachment(db, id, filePath);

      if (!buffer) {
        reply.code(404).send({ error: "Attachment not found" });
        return;
      }

      // Content-Type 및 Content-Disposition 헤더 설정 후 버퍼 전송
      const contentType = guessContentType(filePath);
      const fileName = filePath.split("/").pop() ?? filePath;

      reply
        .header("Content-Type", contentType)
        .header("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`)
        .send(buffer);
    });
  };
}
