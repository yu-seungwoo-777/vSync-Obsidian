CREATE TABLE "admin_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_credentials_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "vaults" ADD COLUMN "api_key_preview" text;