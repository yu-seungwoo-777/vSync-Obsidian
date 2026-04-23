#!/usr/bin/env node
// @MX:NOTE MinIO → PostgreSQL 마크다운 내용 마이그레이션 스크립트
// SPEC: SPEC-P1-STORAGE-002 REQ-007
import { createDbClient } from "../config/database.js";
import { createS3Client, getObject } from "../config/storage.js";
import { files, fileVersions } from "../db/schemas/index.js";
import { eq, and, isNull, desc } from "drizzle-orm";

// CLI 인자 파싱
function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rollback") {
      result["rollback"] = true;
    } else if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] ?? "";
      i++;
    }
  }

  return result;
}

// @MX:ANCHOR 마이그레이션 실행: MinIO 데이터를 PG content 컬럼으로 이관
// @MX:REASON 기존 MinIO 저장 데이터를 새 PG 스키마에 맞게 이관
export async function runMigration(options: {
  db: ReturnType<typeof createDbClient>["db"];
  vaultId?: string;
  rollback?: boolean;
}) {
  const { db, vaultId, rollback } = options;

  if (rollback) {
    return runRollback(db, vaultId);
  }

  console.log("Starting MinIO → PostgreSQL content migration...");

  // content가 NULL이고 fileType이 markdown인 파일 조회
  const conditions = [
    isNull(files.content),
    eq(files.fileType, "markdown"),
  ];
  if (vaultId) {
    conditions.push(eq(files.vaultId, vaultId));
  }

  const nullContentFiles = await db
    .select({
      id: files.id,
      vaultId: files.vaultId,
      path: files.path,
    })
    .from(files)
    .where(and(...conditions));

  console.log(`Found ${nullContentFiles.length} files with NULL content to migrate`);

  const s3 = createS3Client();
  let successCount = 0;
  let failCount = 0;

  for (const file of nullContentFiles) {
    try {
      // 최신 버전의 storageKey 조회
      const versions = await db
        .select({
          id: fileVersions.id,
          storageKey: fileVersions.storageKey,
          versionNum: fileVersions.versionNum,
        })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, file.id))
        .orderBy(desc(fileVersions.versionNum));

      if (versions.length === 0) {
        console.warn(`  Skipping ${file.path}: no versions found`);
        continue;
      }

      // MinIO에서 내용 읽기
      const content = await getObject(versions[0].storageKey, s3);
      const contentStr = content.toString("utf-8");

      // files.content 업데이트
      await db
        .update(files)
        .set({ content: contentStr })
        .where(eq(files.id, file.id));

      // fileVersions.content 업데이트 (모든 버전)
      for (const version of versions) {
        try {
          const versionContent = await getObject(version.storageKey, s3);
          await db
            .update(fileVersions)
            .set({ content: versionContent.toString("utf-8") })
            .where(eq(fileVersions.id, version.id));
        } catch {
          console.warn(`  Warning: Could not migrate version ${version.versionNum} of ${file.path}`);
        }
      }

      successCount++;
      console.log(`  Migrated: ${file.path}`);
    } catch (error) {
      failCount++;
      console.error(`  Failed: ${file.path}`, error);
    }
  }

  console.log(`\nMigration complete: ${successCount} success, ${failCount} failed`);
  return { successCount: successCount, failCount: failCount };
}

// 롤백: content 컬럼을 NULL로 되돌리기
async function runRollback(
  db: ReturnType<typeof createDbClient>["db"],
  vaultId?: string,
) {
  console.log("Starting rollback: setting content columns to NULL...");

  const conditions = [eq(files.fileType, "markdown")];
  if (vaultId) {
    conditions.push(eq(files.vaultId, vaultId));
  }

  // files.content → NULL
  const filesToUpdate = await db
    .select({ id: files.id })
    .from(files)
    .where(and(...conditions));

  for (const file of filesToUpdate) {
    await db
      .update(files)
      .set({ content: null })
      .where(eq(files.id, file.id));
  }

  // fileVersions.content → NULL
  for (const file of filesToUpdate) {
    await db
      .update(fileVersions)
      .set({ content: null })
      .where(eq(fileVersions.fileId, file.id));
  }

  console.log(`Rollback complete: ${filesToUpdate.length} files reverted`);
  return { revertedCount: filesToUpdate.length };
}

// CLI 진입점
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultId = args["vault"] as string | undefined;
  const rollback = args["rollback"] === true;

  if (!vaultId && !rollback) {
    console.log("Usage: migrate-storage [--vault <id>] [--rollback]");
    console.log("  --vault <id>  Migrate specific vault only");
    console.log("  --rollback    Set content columns back to NULL");
  }

  const { db } = createDbClient();

  await runMigration({ db, vaultId, rollback });

  process.exit(0);
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
