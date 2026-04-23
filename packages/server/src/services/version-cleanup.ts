// @MX:NOTE 버전 정리 서비스 - 오래된 파일 버전 자동 삭제 (최대 5개, 7일 TTL)
import { eq, desc } from "drizzle-orm";
import { fileVersions } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";
import { deleteObject } from "../config/storage.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 정리 설정: 최대 5버전, 7일 경과 시 삭제
const MAX_VERSIONS = 5;
const MAX_AGE_DAYS = 7;

// @MX:ANCHOR 파일 버전 정리: 업로드 후 호출하여 오래된 버전 제거
// @MX:REASON 무제한 버전 누적으로 인한 스토리지 과다 사용 방지
export async function cleanupOldVersions(
  db: DbType,
  fileId: string,
): Promise<{ deleted: number }> {
  // 모든 버전을 최신순으로 조회
  const allVersions = await db
    .select({
      id: fileVersions.id,
      storageKey: fileVersions.storageKey,
      createdAt: fileVersions.createdAt,
    })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.versionNum));

  // 버전이 1개 이하면 정리 불필요
  if (allVersions.length <= 1) {
    return { deleted: 0 };
  }

  const now = new Date();
  const cutoffMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  for (let i = 0; i < allVersions.length; i++) {
    const version = allVersions[i];

    // 최신 버전(i=0)은 항상 보존
    if (i === 0) continue;

    // 삭제 조건: 최대 버전 수 초과 OR 보관 기간 초과
    const exceedsMaxVersions = i >= MAX_VERSIONS;
    const exceedsMaxAge = (now.getTime() - version.createdAt.getTime()) > cutoffMs;

    if (exceedsMaxVersions || exceedsMaxAge) {
      // MinIO에서 바이너리 삭제
      try {
        await deleteObject(version.storageKey);
      } catch {
        // MinIO 삭제 실패는 DB 정리를 막지 않음
      }

      // DB에서 버전 레코드 삭제
      await db
        .delete(fileVersions)
        .where(eq(fileVersions.id, version.id));

      deletedCount++;
    }
  }

  return { deleted: deletedCount };
}
