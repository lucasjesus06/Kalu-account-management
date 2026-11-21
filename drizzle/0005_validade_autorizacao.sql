ALTER TABLE "integration_connections" ADD COLUMN "authorization_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "integration_connections" SET "authorization_expires_at" = "created_at" + interval '1 year' WHERE "authorization_expires_at" IS NULL;
