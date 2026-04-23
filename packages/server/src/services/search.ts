import { sql } from "drizzle-orm";
import { files } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 검색 결과 인터페이스
export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
}

// @MX:ANCHOR 전문 검색: pg_trgm 유사도 + ILIKE 조합으로 마크다운 파일 검색
// @MX:REASON Obsidian 동기화의 핵심 검색 기능, 모든 검색 API에서 사용
export async function searchFiles(
  db: DbType,
  vaultId: string,
  query: string,
  options?: {
    limit?: number;
    folder?: string;
  },
): Promise<{ results: SearchResult[]; total: number }> {
  // limit 범위 검증: 기본 20, 최대 100
  const rawLimit = options?.limit ?? 20;
  const limit = Math.min(Math.max(1, rawLimit), 100);
  const folder = options?.folder;

  // pg_trgm 유사도 기반 검색 쿼리
  // similarity()로 관련성 점수 계산, ILIKE로 보조 필터링
  const searchPattern = `%${query}%`;

  // @MX:NOTE 폴더 필터 조건: folder가 지정되면 LIKE 'folder/%' 패턴 적용
  const folderCondition = folder
    ? sql`AND ${files.path} LIKE ${folder + "/%"}`
    : sql``;

  // 유사도 임계값: 0.1 이상 (낮게 설정하여 넓은 검색)
  const results = await db.execute<{
    path: string;
    snippet: string;
    score: number;
  }>(sql`
    SELECT
      ${files.path} as path,
      CASE
        WHEN length(${files.content}) <= 200 THEN ${files.content}
        WHEN position(${query} in ${files.content}) > 0 THEN
          substring(${files.content} from greatest(1, position(${query} in ${files.content}) - 50) for 200)
        ELSE
          left(${files.content}, 200)
      END as snippet,
      COALESCE(similarity(${files.content}, ${query}), 0) as score
    FROM ${files}
    WHERE ${files.vaultId} = ${vaultId}
      AND ${files.deletedAt} IS NULL
      AND ${files.fileType} = 'markdown'
      AND (${files.content} ILIKE ${searchPattern} OR similarity(${files.content}, ${query}) > 0.1)
      ${folderCondition}
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  // 전체 결과 수 카운트
  const countResult = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*) as count
    FROM ${files}
    WHERE ${files.vaultId} = ${vaultId}
      AND ${files.deletedAt} IS NULL
      AND ${files.fileType} = 'markdown'
      AND (${files.content} ILIKE ${searchPattern} OR similarity(${files.content}, ${query}) > 0.1)
      ${folderCondition}
  `);

  const total = Number(countResult[0]?.count ?? 0);

  return {
    results: results.map((r) => ({
      path: r.path,
      snippet: r.snippet ?? "",
      score: Number(r.score),
    })),
    total,
  };
}
