// @MX:NOTE 충돌 관리 서비스 - 서버 측 충돌 감지, 파일 생성, 해결 (SPEC-P5-CONFLICT-001 + SPEC-P5-3WAY-001)
import { eq, and, isNull, desc, count, sql } from "drizzle-orm";
import { files, conflicts, fileVersions } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";
import { uploadFile } from "./file.js";
import { createSyncEvent } from "./sync-event.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 충돌 파일 경로 생성: {basename}.sync-conflict-{YYYYMMDDHHmmss}.md
export function createConflictFilePath(originalPath: string): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  // 경로에서 디렉토리와 파일명 분리
  const lastSlash = originalPath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? originalPath.substring(0, lastSlash + 1) : "";
  const fileName = lastSlash >= 0 ? originalPath.substring(lastSlash + 1) : originalPath;

  // 확장자 분리
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex >= 0 ? fileName.substring(0, dotIndex) : fileName;
  const ext = dotIndex >= 0 ? fileName.substring(dotIndex) : "";

  return `${dir}${baseName}.sync-conflict-${ts}${ext}`;
}

// @MX:ANCHOR 충돌 파일 생성: 거부된 내용을 새 파일로 저장 + conflicts 테이블 기록
// @MX:REASON 충돌 데이터 무손실 보장의 핵심 로직, 모든 충돌 시나리오에서 호출
export async function createConflictFile(
  db: DbType,
  vaultId: string,
  originalFile: typeof files.$inferSelect,
  incomingContent: string,
  incomingHash: string,
  conflictPath: string,
): Promise<{ fileId: string; conflictId: string }> {
  // 충돌 파일을 files 테이블에 저장 (fileType: "conflict")
  const newFile = await db
    .insert(files)
    .values({
      vaultId: vaultId,
      path: conflictPath,
      hash: incomingHash,
      sizeBytes: Buffer.byteLength(incomingContent),
      content: incomingContent,
      fileType: "conflict",
    })
    .returning();

  // conflicts 테이블에 기록
  const conflictRecord = await db
    .insert(conflicts)
    .values({
      vaultId: vaultId,
      fileId: originalFile.id,
      conflictPath: conflictPath,
      incomingHash: incomingHash,
    })
    .returning();

  return {
    fileId: newFile[0].id,
    conflictId: conflictRecord[0].id,
  };
}

// @MX:NOTE 미해결 충돌 목록 조회: files 조인으로 원본 경로 포함
export async function listConflicts(db: DbType, vaultId: string) {
  // 미해결 충돌 조회
  const unresolvedConflicts = await db
    .select({
      id: conflicts.id,
      fileId: conflicts.fileId,
      conflictPath: conflicts.conflictPath,
      incomingHash: conflicts.incomingHash,
      createdAt: conflicts.createdAt,
    })
    .from(conflicts)
    .where(
      and(
        eq(conflicts.vaultId, vaultId),
        isNull(conflicts.resolvedAt),
      ),
    )
    .orderBy(desc(conflicts.createdAt));

  // 원본 파일 경로 조인
  const result = [];
  for (const conflict of unresolvedConflicts) {
    let originalPath: string | null = null;

    if (conflict.fileId) {
      const fileRows = await db
        .select({ path: files.path })
        .from(files)
        .where(eq(files.id, conflict.fileId))
        .limit(1);
      originalPath = fileRows[0]?.path ?? null;
    }

    result.push({
      id: conflict.id,
      original_path: originalPath,
      conflict_path: conflict.conflictPath,
      created_at: conflict.createdAt instanceof Date ? conflict.createdAt.toISOString() : String(conflict.createdAt),
    });
  }

  return { conflicts: result };
}

// @MX:ANCHOR 충돌 해결: accept(원본 덮어쓰기) 또는 reject(충돌 파일 삭제)
// @MX:REASON 데이터 무손실/사용자 선택 보장의 핵심 로직
export async function resolveConflict(
  db: DbType,
  vaultId: string,
  conflictId: string,
  resolution: "accept" | "reject",
  deviceId: string,
) {
  // 충돌 기록 조회
  const conflictRows = await db
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.id, conflictId),
        eq(conflicts.vaultId, vaultId),
      ),
    )
    .limit(1);

  if (conflictRows.length === 0) {
    return { error: "Conflict not found", status: 404 };
  }

  const conflict = conflictRows[0];

  // 이미 해결된 충돌
  if (conflict.resolvedAt) {
    return { error: "Conflict already resolved", status: 404 };
  }

  // 충돌 파일 조회
  const conflictFileRows = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.vaultId, vaultId),
        eq(files.path, conflict.conflictPath),
      ),
    )
    .limit(1);

  if (conflictFileRows.length === 0) {
    return { error: "Conflict file not found", status: 404 };
  }

  const conflictFile = conflictFileRows[0];

  if (resolution === "accept") {
    // accept: 원본을 충돌 파일 내용으로 덮어쓰기
    if (conflict.fileId) {
      const originalFileRows = await db
        .select()
        .from(files)
        .where(eq(files.id, conflict.fileId))
        .limit(1);

      if (originalFileRows.length > 0) {
        // uploadFile로 덮어쓰기 (버전 생성 + 동기화 이벤트)
        await uploadFile(
          db,
          vaultId,
          originalFileRows[0].path,
          conflictFile.content ?? "",
          conflictFile.hash,
          deviceId,
        );
      }
    }

    // 충돌 파일 소프트 삭제
    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(eq(files.id, conflictFile.id));
  } else {
    // reject: 충돌 파일 소프트 삭제, 원본 유지
    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(eq(files.id, conflictFile.id));
  }

  // 충돌 기록 업데이트
  await db
    .update(conflicts)
    .set({
      resolvedAt: new Date(),
      resolution,
    })
    .where(eq(conflicts.id, conflictId));

  // 동기화 이벤트 발생
  await createSyncEvent(
    db,
    vaultId,
    conflictFile.id,
    resolution === "accept" ? "updated" : "deleted",
    deviceId,
  );

  return {
    resolution,
    conflictId: conflictId,
    resolvedAt: new Date().toISOString(),
  };
}

// @MX:ANCHOR merge-resolve: 수동 병합 해결 (SPEC-P5-3WAY-001)
// @MX:REASON 사용자가 모달에서 선택한 병합 결과를 저장, race condition 방지
export async function mergeResolve(
  db: DbType,
  vaultId: string,
  conflictId: string,
  content: string,
  contentHash: string,
  deviceId: string,
) {
  // 충돌 기록 조회
  const conflictRows = await db
    .select()
    .from(conflicts)
    .where(
      and(
        eq(conflicts.id, conflictId),
        eq(conflicts.vaultId, vaultId),
      ),
    )
    .limit(1);

  if (conflictRows.length === 0) {
    return { error: "Conflict not found", status: 404 };
  }

  const conflict = conflictRows[0];

  // 이미 해결된 충돌
  if (conflict.resolvedAt) {
    return { error: "Conflict already resolved", status: 404 };
  }

  // 원본 파일 레코드에 FOR UPDATE 락 획득
  if (conflict.fileId) {
    await db.execute(
      sql`SELECT * FROM files WHERE id = ${conflict.fileId} FOR UPDATE`
    );
  }

  // 충돌 파일 소프트 삭제
  const conflictFileRows = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.vaultId, vaultId),
        eq(files.path, conflict.conflictPath),
      ),
    )
    .limit(1);

  if (conflictFileRows.length > 0) {
    await db
      .update(files)
      .set({ deletedAt: new Date() })
      .where(eq(files.id, conflictFileRows[0].id));
  }

  // 원본 파일에 병합 결과 저장 (mergeType: "manual")
  if (conflict.fileId) {
    const originalFileRows = await db
      .select()
      .from(files)
      .where(eq(files.id, conflict.fileId))
      .limit(1);

    if (originalFileRows.length > 0) {
      // 버전 번호 계산
      const [{ versionCount }] = await db
        .select({ versionCount: count() })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, conflict.fileId));

      const newVersionNum = versionCount + 1;

      // 이전 버전 ID (baseVersionId)
      const prevVersions = await db
        .select({ id: fileVersions.id })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, conflict.fileId))
        .orderBy(desc(fileVersions.versionNum))
        .limit(1);

      // 파일 업데이트
      await db
        .update(files)
        .set({
          hash: contentHash,
          sizeBytes: Buffer.byteLength(content),
          content,
          updatedAt: new Date(),
          deletedAt: null,
        })
        .where(eq(files.id, conflict.fileId));

      // 버전 생성 (mergeType: "manual")
      await db.insert(fileVersions).values({
        fileId: conflict.fileId,
        versionNum: newVersionNum,
        storageKey: `${vaultId}/${originalFileRows[0].path}/${newVersionNum}`,
        contentHash: contentHash,
        content,
        baseVersionId: prevVersions[0]?.id ?? null,
        mergeType: "manual",
      });

      // 동기화 이벤트 발행
      await createSyncEvent(db, vaultId, conflict.fileId, "updated", deviceId);
    }
  }

  // 충돌 기록 업데이트
  await db
    .update(conflicts)
    .set({
      resolvedAt: new Date(),
      resolution: "merge-resolve",
    })
    .where(eq(conflicts.id, conflictId));

  return {
    resolvedAt: new Date().toISOString(),
  };
}

// @MX:NOTE base content 조회: 특정 해시의 파일 버전 내용 반환 (SPEC-P5-3WAY-001)
export async function getBaseContent(
  db: DbType,
  vaultId: string,
  filePath: string,
  hash: string,
) {
  // 파일 조회
  const fileRows = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.vaultId, vaultId),
        eq(files.path, filePath),
        isNull(files.deletedAt),
      ),
    )
    .limit(1);

  if (fileRows.length === 0) {
    return null;
  }

  // 해당 해시의 버전 조회
  const versionRows = await db
    .select({ content: fileVersions.content, contentHash: fileVersions.contentHash })
    .from(fileVersions)
    .where(
      and(
        eq(fileVersions.fileId, fileRows[0].id),
        eq(fileVersions.contentHash, hash),
      ),
    )
    .orderBy(desc(fileVersions.versionNum))
    .limit(1);

  if (versionRows.length === 0) {
    return null;
  }

  return {
    content: versionRows[0].content,
    hash: versionRows[0].contentHash,
  };
}
