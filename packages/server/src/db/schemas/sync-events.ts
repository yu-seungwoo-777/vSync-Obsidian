import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
} from "drizzle-orm/pg-core";
import { vaults } from "./vaults.js";
import { files } from "./files.js";

// @MX:NOTE 변경 이벤트 로그 (폴링 기준점 + NOTIFY 트리거 대상)
export const syncEvents = pgTable("sync_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(), // created | updated | deleted | moved
  // @MX:NOTE moved 이벤트의 원본 경로 (이동 전 파일 경로)
  fromPath: text("from_path"),
  deviceId: text("device_id").notNull(),
  // @MX:NOTE sequence: 동일 타임스탬프 이벤트 식별용 자동 증가 시퀀스 (SPEC-P6-EVENT-007)
  sequence: bigint('sequence', { mode: 'number' }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
