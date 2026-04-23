import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { files } from "./files.js";

// @MX:NOTE 버전 히스토리 (마크다운은 content, 첨부파일은 storageKey로 MinIO 참조)
export const fileVersions = pgTable("file_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  versionNum: integer("version_num").notNull(),
  storageKey: text("storage_key").notNull(),
  contentHash: text("content_hash").notNull(),
  // @MX:NOTE 마크다운 버전 내용 (첨부파일은 NULL)
  content: text("content"),
  // @MX:NOTE 3-way merge 공통 조상 버전 참조 (SPEC-P5-3WAY-001)
  // 버전 정리 시 ON DELETE SET NULL로 null 처리, 병합 불가만 되고 에러는 안 남
  baseVersionId: uuid("base_version_id"),
  // @MX:NOTE 병합 결과 타입: normal | auto | manual | conflict (SPEC-P5-3WAY-001)
  mergeType: text("merge_type").default("normal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
