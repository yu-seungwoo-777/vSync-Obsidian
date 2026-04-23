CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_id" uuid NOT NULL,
	"file_id" uuid,
	"conflict_path" text NOT NULL,
	"incoming_hash" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "file_type" text DEFAULT 'markdown' NOT NULL;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conflicts_vault_unresolved" ON "conflicts" USING btree ("vault_id");