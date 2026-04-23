import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { adminCredentials } from "./admin-credentials.js";

// @MX:NOTE 볼트 단위 격리, JWT 토큰 기반 인증
export const vaults = pgTable("vaults", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  // @MX:NOTE [AUTO] RBAC: 볼트를 생성한 관리자 ID, NULL=v1 API에서 생성
  createdBy: uuid("created_by").references(() => adminCredentials.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
