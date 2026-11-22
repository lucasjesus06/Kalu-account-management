CREATE TABLE "household_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_members" ALTER COLUMN "household_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_memberships_household_member_idx" ON "household_memberships" USING btree ("household_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_memberships_one_admin_idx" ON "household_memberships" USING btree ("household_id") WHERE "household_memberships"."role" = 'admin';--> statement-breakpoint
CREATE INDEX "household_memberships_member_idx" ON "household_memberships" USING btree ("member_id");
--> statement-breakpoint
INSERT INTO "household_memberships" ("household_id", "member_id", "role", "created_at")
SELECT m."household_id", m."id",
  CASE WHEN row_number() OVER (PARTITION BY m."household_id" ORDER BY m."created_at", m."id") = 1 THEN 'admin' ELSE 'member' END,
  m."created_at"
FROM "household_members" m
WHERE m."household_id" IS NOT NULL;
