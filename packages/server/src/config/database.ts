import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schemas/index.js";

export const databaseConfig = {
  url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/obsidiansync",
};

export function createDbClient(url?: string) {
  const client = postgres(url ?? databaseConfig.url);
  const db = drizzle(client, { schema });
  return { client, db };
}
