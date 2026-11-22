CREATE TABLE "household_shared_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"shared_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_shared_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "household_shared_accounts" ADD CONSTRAINT "household_shared_accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_shared_accounts" ADD CONSTRAINT "household_shared_accounts_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_shared_accounts" ADD CONSTRAINT "household_shared_accounts_shared_by_member_id_household_members_id_fk" FOREIGN KEY ("shared_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_shared_accounts_account_idx" ON "household_shared_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "household_shared_accounts_household_idx" ON "household_shared_accounts" USING btree ("household_id");
--> statement-breakpoint
INSERT INTO "household_shared_accounts" ("household_id", "account_id", "shared_by_member_id")
SELECT DISTINCT ON (a."id") ms."household_id", a."id", m."id"
FROM "financial_accounts" a
JOIN "integration_connections" c ON c."id" = a."connection_id"
JOIN "household_members" m ON m."id" = c."member_id"
JOIN "household_memberships" ms ON ms."member_id" = m."id"
ORDER BY a."id", ms."created_at", ms."id";
