ALTER TABLE "sync_runs" ADD COLUMN "transactions_created" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "transactions_updated" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "transactions_removed" integer DEFAULT 0 NOT NULL;