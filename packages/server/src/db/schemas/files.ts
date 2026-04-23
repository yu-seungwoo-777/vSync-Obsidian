import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { vaults } from "./vaults.js";

// @MX:NOTE 파일 메타데이터 (마크다운은 PG content, 첨부파일은 MinIO storageKey)
export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    hash: text("hash").notNull(),
    sizeBytes: integer("size_bytes"),
    // @MX:NOTE 마크다운 내용은 PG에 직접 저장, 첨부파일은 NULL
    content: text("content"),
    // @MX:NOTE 파일 타입: "markdown" (PG 저장) | "attachment" (MinIO 저장)
    fileType: text("file_type").default("markdown").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("files_vault_path_uniq").on(t.vaultId, t.path)],
);
