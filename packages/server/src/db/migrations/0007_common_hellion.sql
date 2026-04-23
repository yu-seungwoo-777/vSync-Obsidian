ALTER TABLE "sync_events" ADD COLUMN "from_path" text;--> statement-breakpoint
ALTER TABLE "vaults" DROP COLUMN "api_key_hash";--> statement-breakpoint
ALTER TABLE "vaults" DROP COLUMN "api_key";--> statement-breakpoint
ALTER TABLE "vaults" DROP COLUMN "api_key_preview";