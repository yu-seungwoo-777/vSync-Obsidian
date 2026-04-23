import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { vaults } from "./vaults.js";

// @MX:NOTE 디바이스별 sync 커서 (폴링 복구 기준점)
export const deviceSyncState = pgTable("device_sync_state", {
  deviceId: text("device_id").notNull(),
  vaultId: uuid("vault_id")
    .notNull()
    .references(() => vaults.id, { onDelete: "cascade" }),
  lastEventId: uuid("last_event_id").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }).defaultNow().notNull(),
});
