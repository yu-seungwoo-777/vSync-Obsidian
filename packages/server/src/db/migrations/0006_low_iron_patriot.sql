ALTER TABLE "admin_credentials" ADD COLUMN "role" varchar(20) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "vaults" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "vaults" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_created_by_admin_credentials_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_credentials"("id") ON DELETE no action ON UPDATE no action;