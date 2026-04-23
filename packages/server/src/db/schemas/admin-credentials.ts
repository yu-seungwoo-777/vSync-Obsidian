import {
  pgTable,
  uuid,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";

// @MX:NOTE 관리자 인증 정보 저장 (초기 설정 시 1회 생성)
export const adminCredentials = pgTable("admin_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // @MX:NOTE [AUTO] RBAC 역할: 'admin' 또는 'user', 기본값 'user'
  role: varchar("role", { length: 20 }).notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
