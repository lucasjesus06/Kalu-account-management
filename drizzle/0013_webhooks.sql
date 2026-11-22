CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'pluggy' NOT NULL,
	"external_event_id" text NOT NULL,
	"event" text NOT NULL,
	"external_item_id" text,
	"connection_id" uuid,
	"triggered_by" text,
	"result" text,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pluggy_credentials" ADD COLUMN "webhook_id" text;--> statement-breakpoint
ALTER TABLE "pluggy_credentials" ADD COLUMN "webhook_registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_idx" ON "webhook_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_connection_idx" ON "webhook_events" USING btree ("connection_id","received_at");