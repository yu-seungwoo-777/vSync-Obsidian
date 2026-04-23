// @MX:NOTE 충돌 테이블 스키마 - 서버 감지 충돌 추적 (SPEC-P5-CONFLICT-001)
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { vaults } from "./vaults.js";
import { files } from "./files.js";

// @MX:NOTE 충돌 기록: 서버 감지 충돌 시 거부된 클라이언트 내용 보관
export const conflicts = pgTable(
  "conflicts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    // @MX:NOTE 원본 파일이 삭제되어도 충돌 기록은 보존 (SET NULL)
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    conflictPath: text("conflict_path").notNull(),
    incomingHash: text("incoming_hash").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"), // "accept" | "reject"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // @MX:NOTE 미해결 충돌 빠른 조회용 인덱스
    index("idx_conflicts_vault_unresolved").on(t.vaultId),
  ],
);
