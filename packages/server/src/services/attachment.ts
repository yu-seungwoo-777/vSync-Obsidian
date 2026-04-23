import { eq, and, desc, count } from "drizzle-orm";
import crypto from "node:crypto";
import { files, fileVersions } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";
import { putObject, getObject } from "../config/storage.js";
import { createSyncEvent } from "./sync-event.js";
import { cleanupOldVersions } from "./version-cleanup.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE MinIO 스토리지 키 패턴: {vaultId}/{filePath}/{versionNum}
function buildStorageKey(vaultId: string, filePath: string, versionNum: number): string {
  return `${vaultId}/${filePath}/${versionNum}`;
}

// vaultId + path로 파일 조회
function findFileByPath(db: DbType, vaultId: string, filePath: string) {
  return db
    .select()
    .from(files)
    .where(and(eq(files.vaultId, vaultId), eq(files.path, filePath)))
    .limit(1);
}

// @MX:ANCHOR 첨부파일 업로드: 바이너리를 MinIO에 저장, 메타데이터는 PG에 기록
// @MX:REASON 첨부파일은 PG에 저장 불가하므로 MinIO 스토리지 사용
export async function uploadAttachment(
  db: DbType,
  vaultId: string,
  filePath: string,
  body: Buffer,
  deviceId: string = "unknown",
) {
  // @MX:NOTE 바이너리 SHA-256 해시 계산 (무결성 검증 및 중복 스킵용)
  const contentHash = crypto
    .createHash("sha256")
    .update(body)
    .digest("hex");

  // 기존 파일 조회
  const existing = await findFileByPath(db, vaultId, filePath);

  if (existing.length > 0) {
    const existingFile = existing[0];

    // 삭제 후 재업로드 시 복원
    if (!existingFile.deletedAt) {
      // @MX:NOTE 동일 해시면 스킵 (불필요한 버전 생성 방지)
      if (existingFile.hash === contentHash) {
        const currentVersions = await db
          .select()
          .from(fileVersions)
          .where(eq(fileVersions.fileId, existingFile.id))
          .orderBy(desc(fileVersions.versionNum))
          .limit(1);

        return {
          id: existingFile.id,
          path: existingFile.path,
          version: currentVersions[0]?.versionNum ?? 1,
        };
      }

      // 새 버전 생성
      const [{ versionCount }] = await db
        .select({ versionCount: count() })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, existingFile.id));

      const newVersionNum = versionCount + 1;
      const storageKey = buildStorageKey(vaultId, filePath, newVersionNum);

      // MinIO에 업로드
      await putObject(storageKey, body);

      // 파일 메타데이터 업데이트
      await db
        .update(files)
        .set({
          sizeBytes: body.byteLength,
          updatedAt: new Date(),
          deletedAt: null,
        })
        .where(eq(files.id, existingFile.id));

      // 버전 레코드 생성
      await db.insert(fileVersions).values({
        fileId: existingFile.id,
        versionNum: newVersionNum,
        storageKey,
        contentHash,
        content: null,
      });

      // 동기화 이벤트 생성
      await createSyncEvent(db, vaultId, existingFile.id, "updated", deviceId);

      // 오래된 버전 정리 (최대 5개, 7일 TTL)
      await cleanupOldVersions(db, existingFile.id);

      return {
        id: existingFile.id,
        path: existingFile.path,
        version: newVersionNum,
      };
    }

    // 삭제된 파일 복원
    const [{ versionCount }] = await db
      .select({ versionCount: count() })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, existingFile.id));

    const newVersionNum = versionCount + 1;
    const storageKey = buildStorageKey(vaultId, filePath, newVersionNum);

    await putObject(storageKey, body);

    await db
      .update(files)
      .set({
        sizeBytes: body.byteLength,
        updatedAt: new Date(),
        deletedAt: null,
      })
      .where(eq(files.id, existingFile.id));

    await db.insert(fileVersions).values({
      fileId: existingFile.id,
      versionNum: newVersionNum,
      storageKey,
      contentHash,
      content: null,
    });

    await createSyncEvent(db, vaultId, existingFile.id, "updated", deviceId);

    return {
      id: existingFile.id,
      path: existingFile.path,
      version: newVersionNum,
    };
  }

  // 새 파일 생성
  const storageKey = buildStorageKey(vaultId, filePath, 1);

  // MinIO에 업로드
  await putObject(storageKey, body);

  // 파일 레코드 생성
  const newFile = await db
    .insert(files)
    .values({
      vaultId,
      path: filePath,
      hash: contentHash,
      sizeBytes: body.byteLength,
      content: null,
      fileType: "attachment",
    })
    .returning();

  // 버전 1 레코드 생성
  await db.insert(fileVersions).values({
    fileId: newFile[0].id,
    versionNum: 1,
    storageKey,
    contentHash: contentHash + "-v1",
    content: null,
  });

  // 동기화 이벤트 생성
  await createSyncEvent(db, vaultId, newFile[0].id, "created", deviceId);

  return {
    id: newFile[0].id,
    path: newFile[0].path,
    version: 1,
  };
}

// @MX:ANCHOR 첨부파일 조회: MinIO에서 바이너리 반환
// @MX:REASON content가 NULL이므로 storageKey로 MinIO에서 조회
export async function getAttachment(
  db: DbType,
  vaultId: string,
  filePath: string,
): Promise<Buffer | null> {
  const fileRows = await findFileByPath(db, vaultId, filePath);

  if (fileRows.length === 0 || fileRows[0].deletedAt) {
    return null;
  }

  const file = fileRows[0];

  // 최신 버전 조회
  const versions = await db
    .select({ storageKey: fileVersions.storageKey })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, file.id))
    .orderBy(desc(fileVersions.versionNum))
    .limit(1);

  if (versions.length === 0) {
    return null;
  }

  // MinIO에서 바이너리 가져오기
  return getObject(versions[0].storageKey);
}
