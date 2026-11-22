CREATE TABLE "change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"scope" text,
	"previous_value" text,
	"new_value" text,
	"affected_count" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_household_occurred_idx" ON "change_log" USING btree ("household_id","occurred_at");