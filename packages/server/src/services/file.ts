import { eq, and, isNull, desc, count, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { files, fileVersions } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";
import { putObject } from "../config/storage.js";
import { createSyncEvent } from "./sync-event.js";
import { createConflictFilePath, createConflictFile } from "./conflict.js";
import { cleanupOldVersions } from "./version-cleanup.js";
import { attemptThreeWayMerge } from "./three-way-merge.js";
import type { DiffOperation } from "./three-way-merge.js";
import { normalizePath } from "../utils/path.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 텍스트 파일 확장자 목록
const TEXT_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt", ".json", ".csv"];

// @MX:NOTE 파일 경로와 Content-Type으로 텍스트 파일 여부 판별
export function isTextFile(filePath: string, contentType?: string): boolean {
  // Content-Type이 text/*이면 텍스트
  if (contentType && contentType.startsWith("text/")) {
    return true;
  }
  // 확장자 기반 판별
  const lowerPath = filePath.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

// @MX:NOTE MinIO 스토리지 키 패턴: {vaultId}/{filePath}/{versionNum}
function buildStorageKey(vaultId: string, filePath: string, versionNum: number): string {
  return `${vaultId}/${filePath}/${versionNum}`;
}

// vaultId + path로 파일 조회 (중복 패턴 통합)
function findFileByPath(db: DbType, vaultId: string, filePath: string) {
  return db
    .select()
    .from(files)
    .where(and(eq(files.vaultId, vaultId), eq(files.path, filePath)))
    .limit(1);
}

// @MX:NOTE 업로드 결과 타입
export type UploadResult = {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  version: number;
  autoMerged?: boolean;
  mergeType?: "normal" | "auto";
};

// @MX:NOTE 충돌 결과 타입 (baseHash 불일치 시)
export type ConflictResult = {
  conflict: true;
  currentHash: string;
  incomingHash: string;
  conflictPath: string;
  baseHash?: string;
  diff?: DiffOperation[];
  canAutoMerge?: false;
};

// @MX:ANCHOR 파일 업로드: 마크다운은 PG에 저장, 첨부파일은 MinIO에 저장
// @MX:REASON 파일 동기화의 핵심 로직, 스토리지 전환 진입점
export async function uploadFile(
  db: DbType,
  vaultId: string,
  filePath: string,
  content: string,
  contentHash: string,
  deviceId: string = "unknown",
  contentType?: string,
  baseHash?: string,
): Promise<UploadResult | ConflictResult> {
  const isText = isTextFile(filePath, contentType);
  const fileType = isText ? "markdown" as const : "attachment" as const;

  // 기존 파일 조회
  const existing = await findFileByPath(db, vaultId, filePath);

  if (existing.length > 0) {
    const existingFile = existing[0];

    // @MX:NOTE baseHash 충돌 감지: 클라이언트가 보낸 해시와 서버 해시가 다르면 충돌
    if (baseHash && existingFile.hash !== baseHash && !existingFile.deletedAt) {
      // 텍스트 파일이면 3-way merge 시도
      if (isText) {
        // @MX:NOTE REQ-SRV-002: FOR UPDATE부터 merge 결과 저장까지 트랜잭션으로 래핑
        return await db.transaction(async (tx) => {
          // FOR UPDATE 락 획득: race condition 방지
          await tx.execute(
            sql`SELECT * FROM files WHERE id = ${existingFile.id} FOR UPDATE`
          );

          // base 해시에 해당하는 버전의 content 조회
          const baseVersions = await tx
            .select({ content: fileVersions.content, id: fileVersions.id })
            .from(fileVersions)
            .where(
              and(
                eq(fileVersions.fileId, existingFile.id),
                eq(fileVersions.contentHash, baseHash),
              ),
            )
            .orderBy(desc(fileVersions.versionNum))
            .limit(1);

          const baseContent = baseVersions.length > 0 ? baseVersions[0].content : null;

          // 3-way merge 시도
          const mergeResult = attemptThreeWayMerge(
            baseContent,
            existingFile.content ?? "",
            content,
          );

          if (mergeResult.type === "auto") {
            // 자동 병합 성공 → 병합 결과 저장
            const mergedContent = mergeResult.content;
            const mergedHash = crypto
              .createHash("sha256")
              .update(mergedContent)
              .digest("hex");

            // 이전 버전 조회 (baseVersionId용)
            const prevVersions = await tx
              .select({ id: fileVersions.id })
              .from(fileVersions)
              .where(eq(fileVersions.fileId, existingFile.id))
              .orderBy(desc(fileVersions.versionNum))
              .limit(1);

            // 새 버전 번호
            const [{ versionCount }] = await tx
              .select({ versionCount: count() })
              .from(fileVersions)
              .where(eq(fileVersions.fileId, existingFile.id));
            const newVersionNum = versionCount + 1;
            const storageKey = buildStorageKey(vaultId, filePath, newVersionNum);

            // 파일 업데이트
            const updated = await tx
              .update(files)
              .set({
                hash: mergedHash,
                sizeBytes: Buffer.byteLength(mergedContent),
                content: mergedContent,
                fileType,
                updatedAt: new Date(),
                deletedAt: null,
              })
              .where(eq(files.id, existingFile.id))
              .returning();

            // 버전 생성 (mergeType: "auto", baseVersionId 설정)
            await tx.insert(fileVersions).values({
              fileId: existingFile.id,
              versionNum: newVersionNum,
              storageKey,
              contentHash: mergedHash,
              content: mergedContent,
              baseVersionId: prevVersions[0]?.id ?? null,
              mergeType: "auto",
            });

            // 동기화 이벤트
            await createSyncEvent(tx as DbType, vaultId, existingFile.id, "updated", deviceId);
            await cleanupOldVersions(tx as DbType, existingFile.id);

            return {
              id: updated[0].id,
              path: updated[0].path,
              hash: mergedHash,
              sizeBytes: updated[0].sizeBytes,
              version: newVersionNum,
              autoMerged: true,
              mergeType: "auto",
            };
          }

          // 자동 병합 불가 → 충돌 파일 생성 (diff 데이터 포함)
          const conflictPath = createConflictFilePath(filePath);
          await createConflictFile(tx as DbType, vaultId, existingFile, content, contentHash, conflictPath);

          return {
            conflict: true,
            currentHash: existingFile.hash,
            incomingHash: contentHash,
            conflictPath,
            baseHash,
            diff: mergeResult.type === "conflict" ? mergeResult.diff : [],
            canAutoMerge: false,
          };
        });
      }

      // 바이너리 파일: 기존 충돌 처리
      const conflictPath = createConflictFilePath(filePath);
      await createConflictFile(db, vaultId, existingFile, content, contentHash, conflictPath);
      return {
        conflict: true,
        currentHash: existingFile.hash,
        incomingHash: contentHash,
        conflictPath,
      };
    }

    // 동일한 해시이고 삭제되지 않은 파일이면 스킵
    if (existingFile.hash === contentHash && !existingFile.deletedAt) {
      // 현재 버전 번호 조회
      const currentVersions = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, existingFile.id))
        .orderBy(desc(fileVersions.versionNum))
        .limit(1);

      return {
        id: existingFile.id,
        path: existingFile.path,
        hash: existingFile.hash,
        sizeBytes: existingFile.sizeBytes,
        version: currentVersions[0]?.versionNum ?? 1,
      };
    }

    // 새 버전 번호 계산 (COUNT 쿼리로 최적화)
    const [{ versionCount }] = await db
      .select({ versionCount: count() })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, existingFile.id));

    const newVersionNum = versionCount + 1;
    const storageKey = buildStorageKey(vaultId, filePath, newVersionNum);

    // 이전 버전 조회 (baseVersionId용)
    const prevVersionForBase = await db
      .select({ id: fileVersions.id })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, existingFile.id))
      .orderBy(desc(fileVersions.versionNum))
      .limit(1);

    // 첨부파일만 MinIO에 업로드
    if (!isText) {
      await putObject(storageKey, content);
    }

    // 파일 메타데이터 업데이트
    const updated = await db
      .update(files)
      .set({
        hash: contentHash,
        sizeBytes: Buffer.byteLength(content),
        content: isText ? content : null,
        fileType,
        updatedAt: new Date(),
        deletedAt: null, // 삭제 후 재업로드 시 복원
      })
      .where(eq(files.id, existingFile.id))
      .returning();

    // 버전 레코드 생성 (baseVersionId 설정)
    await db.insert(fileVersions).values({
      fileId: existingFile.id,
      versionNum: newVersionNum,
      storageKey,
      contentHash,
      content: isText ? content : null,
      baseVersionId: prevVersionForBase[0]?.id ?? null,
      mergeType: "normal",
    });

    // 동기화 이벤트 생성
    await createSyncEvent(db, vaultId, existingFile.id, "updated", deviceId);

    // 오래된 버전 정리 (최대 5개, 7일 TTL)
    await cleanupOldVersions(db, existingFile.id);

    return {
      id: updated[0].id,
      path: updated[0].path,
      hash: updated[0].hash,
      sizeBytes: updated[0].sizeBytes,
      version: newVersionNum,
    };
  }

  // @MX:NOTE REQ-SRV-003: 새 파일 생성 - upsert 패턴으로 경쟁 상태 원자적 처리
  // 동시 INSERT 시 files_vault_path_uniq UNIQUE 제약으로 중복 방지
  const sizeBytes = Buffer.byteLength(content);
  const storageKey = buildStorageKey(vaultId, filePath, 1);

  // 첨부파일만 MinIO에 업로드 (DB 트랜잭션 외부)
  if (!isText) {
    await putObject(storageKey, content);
  }

  // upsert: INSERT 시도 → 충돌 시 기존 레코드 재조회 후 업데이트 경로 처리
  const result = await db.transaction(async (tx) => {
    const insertResult = await tx
      .insert(files)
      .values({
        vaultId,
        path: filePath,
        hash: contentHash,
        sizeBytes,
        content: isText ? content : null,
        fileType,
      })
      .onConflictDoNothing({ target: [files.vaultId, files.path] })
      .returning();

    // INSERT 성공 (충돌 없음) → 신규 파일 생성 완료
    if (insertResult.length > 0) {
      const newFile = insertResult[0];

      // 버전 1 레코드 생성
      await tx.insert(fileVersions).values({
        fileId: newFile.id,
        versionNum: 1,
        storageKey,
        contentHash,
        content: isText ? content : null,
      });

      // 동기화 이벤트 생성
      await createSyncEvent(tx as DbType, vaultId, newFile.id, "created", deviceId);

      return {
        id: newFile.id,
        path: newFile.path,
        hash: newFile.hash,
        sizeBytes: newFile.sizeBytes,
        version: 1,
      };
    }

    // INSERT 충돌 (onConflictDoNothing) → 기존 파일을 재조회하여 업데이트
    const existingAfterConflict = await tx
      .select()
      .from(files)
      .where(and(eq(files.vaultId, vaultId), eq(files.path, filePath)))
      .limit(1);

    if (existingAfterConflict.length === 0) {
      throw new Error(`File not found after conflict: ${filePath}`);
    }

    const existingFile = existingAfterConflict[0];

    // 동일 해시면 스킵
    if (existingFile.hash === contentHash && !existingFile.deletedAt) {
      const currentVersions = await tx
        .select({ versionNum: fileVersions.versionNum })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, existingFile.id))
        .orderBy(desc(fileVersions.versionNum))
        .limit(1);

      return {
        id: existingFile.id,
        path: existingFile.path,
        hash: existingFile.hash,
        sizeBytes: existingFile.sizeBytes,
        version: currentVersions[0]?.versionNum ?? 1,
      };
    }

    // 새 버전 생성
    const [{ versionCount }] = await tx
      .select({ versionCount: count() })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, existingFile.id));
    const newVersionNum = versionCount + 1;
    const newStorageKey = buildStorageKey(vaultId, filePath, newVersionNum);

    const updated = await tx
      .update(files)
      .set({
        hash: contentHash,
        sizeBytes,
        content: isText ? content : null,
        fileType,
        updatedAt: new Date(),
        deletedAt: null,
      })
      .where(eq(files.id, existingFile.id))
      .returning();

    await tx.insert(fileVersions).values({
      fileId: existingFile.id,
      versionNum: newVersionNum,
      storageKey: newStorageKey,
      contentHash,
      content: isText ? content : null,
      mergeType: "normal",
    });

    await createSyncEvent(tx as DbType, vaultId, existingFile.id, "updated", deviceId);

    return {
      id: updated[0].id,
      path: updated[0].path,
      hash: updated[0].hash,
      sizeBytes: updated[0].sizeBytes,
      version: newVersionNum,
    };
  });

  return result;
}

// 파일 내용 조회
export async function getFile(
  db: DbType,
  vaultId: string,
  filePath: string,
) {
  const fileRows = await findFileByPath(db, vaultId, filePath);

  if (fileRows.length === 0 || fileRows[0].deletedAt) {
    return null;
  }

  const file = fileRows[0];

  // 마크다운 파일: PG에서 content 직접 반환
  if (file.content !== null) {
    // 최신 버전 번호 조회
    const versions = await db
      .select({ versionNum: fileVersions.versionNum })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file.id))
      .orderBy(desc(fileVersions.versionNum))
      .limit(1);

    return {
      id: file.id,
      path: file.path,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
      content: file.content,
      version: versions[0]?.versionNum ?? 1,
    };
  }

  // 첨부파일: 메타데이터만 반환 (바이너리는 GET /attachment/* 사용)
  if (file.fileType === "attachment") {
    const versions = await db
      .select({ versionNum: fileVersions.versionNum })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file.id))
      .orderBy(desc(fileVersions.versionNum))
      .limit(1);

    return {
      id: file.id,
      path: file.path,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
      fileType: file.fileType as "attachment",
      content: null,
      version: versions[0]?.versionNum ?? 1,
    };
  }

  // 이외 경우 (content가 NULL인 마크다운 - 마이그레이션 전 데이터)
  return {
    id: file.id,
    path: file.path,
    hash: file.hash,
    sizeBytes: file.sizeBytes,
    fileType: file.fileType as "markdown" | "attachment",
    content: null,
    version: 1,
  };
}

// 파일 소프트 삭제
export async function deleteFile(
  db: DbType,
  vaultId: string,
  filePath: string,
  deviceId: string = "unknown",
) {
  const fileRows = await findFileByPath(db, vaultId, filePath);

  if (fileRows.length === 0 || fileRows[0].deletedAt) {
    return null;
  }

  await db
    .update(files)
    .set({ deletedAt: new Date() })
    .where(eq(files.id, fileRows[0].id));

  // 동기화 이벤트 생성
  await createSyncEvent(db, vaultId, fileRows[0].id, "deleted", deviceId);

  return { deleted: true, path: filePath };
}

// 파일 목록 조회 (삭제된 파일 제외)
export async function listFiles(
  db: DbType,
  vaultId: string,
  options?: { limit?: number },
) {
  const query = db
    .select({
      id: files.id,
      path: files.path,
      hash: files.hash,
      sizeBytes: files.sizeBytes,
      createdAt: files.createdAt,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(and(eq(files.vaultId, vaultId), isNull(files.deletedAt)));

  if (options?.limit) {
    return query.limit(options.limit);
  }
  return query;
}

// 파일 버전 목록 조회
export async function listVersions(
  db: DbType,
  vaultId: string,
  filePath: string,
) {
  const fileRows = await findFileByPath(db, vaultId, filePath);

  if (fileRows.length === 0) {
    return null;
  }

  const versions = await db
    .select({
      versionNum: fileVersions.versionNum,
      contentHash: fileVersions.contentHash,
      storageKey: fileVersions.storageKey,
      createdAt: fileVersions.createdAt,
    })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileRows[0].id))
    .orderBy(fileVersions.versionNum);

  return { versions };
}

// @MX:ANCHOR 파일 편집: oldText → newText 교체, 자동 해시/버전/동기화 이벤트 처리
// @MX:REASON 파일 내용 편집의 핵심 로직, 버전 관리 및 동기화와 연동
export async function editFile(
  db: DbType,
  vaultId: string,
  filePath: string,
  oldText: string,
  newText: string,
  deviceId: string = "unknown",
) {
  // 파일 조회
  const fileRows = await findFileByPath(db, vaultId, filePath);

  if (fileRows.length === 0 || fileRows[0].deletedAt) {
    return { error: "File not found", status: 404 };
  }

  const file = fileRows[0];

  // 마크다운 파일만 편집 가능
  if (file.fileType !== "markdown") {
    return { error: "Only markdown files can be edited", status: 400 };
  }

  // 파일 내용 조회
  const content = file.content ?? "";

  // oldText 매치 확인
  if (!content.includes(oldText)) {
    return { error: "No matches found for old_text", status: 400 };
  }

  // 텍스트 교체 (모든 발생 횟수)
  const changes = content.split(oldText).length - 1;
  const newContent = content.replaceAll(oldText, newText);

  // SHA-256 해시 자동 계산
  const contentHash = crypto
    .createHash("sha256")
    .update(newContent)
    .digest("hex");

  // uploadFile 재사용: 버전 생성 + 동기화 이벤트 자동 처리
  // @MX:NOTE editFile은 파일 존재 확인 후 호출하므로 충돌 발생하지 않음
  const result = await uploadFile(
    db,
    vaultId,
    filePath,
    newContent,
    contentHash,
    deviceId,
  );

  if ("conflict" in result) {
    return { error: "Unexpected conflict during edit", status: 500 };
  }

  return {
    id: result.id,
    path: result.path,
    version: result.version,
    hash: result.hash,
    changes,
  };
}

// @MX:ANCHOR 폴더 목록 조회: 파일/하위폴더 트리 구조 반환
// @MX:REASON Obsidian 파일 탐색기의 핵심 API, 폴더 네비게이션에 사용
export async function listFolder(
  db: DbType,
  vaultId: string,
  folder: string = "/",
  recursive: boolean = false,
) {
  // 폴더 경로 정규화 (앞뒤 / 제거, 중복 슬래시 축소)
  const normalizedFolder = normalizePath(folder);

  // @MX:NOTE 폴더 내 파일 조회: 삭제되지 않은 파일만
  const allFiles = await db
    .select({
      path: files.path,
      hash: files.hash,
      sizeBytes: files.sizeBytes,
      updatedAt: files.updatedAt,
    })
    .from(files)
    .where(
      and(
        eq(files.vaultId, vaultId),
        isNull(files.deletedAt),
        normalizedFolder
          ? sql`${files.path} LIKE ${normalizedFolder + "/%"}`
          : sql`${files.path} NOT LIKE ${"/%"}`,
      ),
    );

  const entries: Array<{
    name: string;
    path: string;
    type: "file" | "folder";
    hash?: string;
    sizeBytes?: number | null;
    updatedAt?: Date;
  }> = [];

  // 추출된 폴더 경로 집합 (중복 제거)
  const folderSet = new Set<string>();

  for (const file of allFiles) {
    // 폴더 프리픽스 제거하여 상대 경로 계산
    const relativePath = normalizedFolder
      ? file.path.slice(normalizedFolder.length + 1)
      : file.path;

    const segments = relativePath.split("/");

    if (recursive) {
      // recursive=true: 모든 파일 포함
      entries.push({
        name: segments[segments.length - 1],
        path: file.path,
        type: "file",
        hash: file.hash,
        sizeBytes: file.sizeBytes,
        updatedAt: file.updatedAt,
      });
    } else {
      // recursive=false: 직접 하위 항목만
      if (segments.length === 1) {
        // 직접 하위 파일
        entries.push({
          name: segments[0],
          path: file.path,
          type: "file",
          hash: file.hash,
          sizeBytes: file.sizeBytes,
          updatedAt: file.updatedAt,
        });
      } else if (segments.length > 1) {
        // 하위 폴더 - 중복 제거
        const folderName = segments[0];
        const folderPath = normalizedFolder
          ? `${normalizedFolder}/${folderName}`
          : folderName;

        if (!folderSet.has(folderPath)) {
          folderSet.add(folderPath);
          entries.push({
            name: folderName,
            path: folderPath,
            type: "folder",
          });
        }
      }
    }
  }

  // recursive=true인 경우 폴더도 추가 (파일 경로에서 추출)
  if (recursive) {
    const allFolderPaths = new Set<string>();
    for (const file of allFiles) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        allFolderPaths.add(parts.slice(0, i).join("/"));
      }
    }
    for (const fPath of allFolderPaths) {
      // 지정된 폴더 하위인지 확인
      if (normalizedFolder && !fPath.startsWith(normalizedFolder + "/")) continue;
      if (!normalizedFolder && fPath.includes("/") && !fPath.startsWith(normalizedFolder)) {
        // 루트 폴더의 하위
      }
      const name = fPath.split("/").pop()!;
      entries.push({ name, path: fPath, type: "folder" });
    }
  }

  return {
    folder: folder,
    entries,
  };
}
