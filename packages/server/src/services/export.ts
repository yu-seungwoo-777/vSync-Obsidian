import { eq, and, isNull } from "drizzle-orm";
import { files, fileVersions } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";
import fs from "node:fs";
import path from "node:path";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 볼트 전체 활성 파일 + fileVersions content에서 내용 반환
export async function exportVault(
  db: DbType,
  vaultId: string,
) {
  // 활성 파일 + 최신 버전 content를 단일 쿼리로 조회
  const activeFiles = await db
    .select({
      id: files.id,
      path: files.path,
      hash: files.hash,
      updatedAt: files.updatedAt,
      content: fileVersions.content,
      versionNum: fileVersions.versionNum,
    })
    .from(files)
    .innerJoin(
      fileVersions,
      and(
        eq(fileVersions.fileId, files.id),
        // 최신 버전만 조회하는 서브쿼리 대신 별도 처리
      ),
    )
    .where(and(eq(files.vaultId, vaultId), isNull(files.deletedAt)));

  // 각 파일의 최신 버전만 필터링
  const latestByFile = new Map<string, typeof activeFiles[0]>();
  for (const row of activeFiles) {
    const existing = latestByFile.get(row.id);
    if (!existing || row.versionNum > existing.versionNum) {
      latestByFile.set(row.id, row);
    }
  }

  const result: { path: string; content: string; hash: string; version: number; updated_at: string }[] = [];
  for (const file of latestByFile.values()) {
    if (file.content === null) continue; // 첨부파일은 스킵
    result.push({
      path: file.path,
      content: file.content,
      hash: file.hash,
      version: file.versionNum,
      updated_at: file.updatedAt instanceof Date ? file.updatedAt.toISOString() : String(file.updatedAt),
    });
  }

  return result;
}

// @MX:NOTE 파일시스템에 마크다운 파일로 내보내기 (git-sync에서 사용)
export async function exportToDirectory(
  db: DbType,
  vaultId: string,
  targetDir: string,
) {
  const exportedFiles = await exportVault(db, vaultId);

  for (const file of exportedFiles) {
    // @MX:WARN 경로 순회 방지: file.path 정규화 후 targetDir 이탈 검증
    // @MX:REASON DB에 저장된 경로가 ../ 를 포함하면 targetDir 밖에 파일 생성 가능
    const normalizedPath = path.normalize(file.path);
    if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      continue; // 위험한 경로는 건너뜀
    }
    const filePath = path.join(targetDir, normalizedPath);

    // targetDir 내부인지 최종 확인
    const resolvedTarget = path.resolve(targetDir);
    const resolvedFile = path.resolve(filePath);
    if (!resolvedFile.startsWith(resolvedTarget + path.sep) && resolvedFile !== resolvedTarget) {
      continue;
    }

    const dir = path.dirname(filePath);

    // 디렉토리 생성
    fs.mkdirSync(dir, { recursive: true });

    // 파일 쓰기
    fs.writeFileSync(filePath, file.content, "utf-8");
  }
}
