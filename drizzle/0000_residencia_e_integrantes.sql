CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "households" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_members_household_id_idx" ON "household_members" USING btree ("household_id");