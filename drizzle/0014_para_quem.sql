CREATE TABLE "expense_nature_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"merchant_name" text NOT NULL,
	"expense_nature" text NOT NULL,
	"expense_member_id" uuid,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_nature_rules_member_check" CHECK (case when "expense_nature_rules"."expense_nature" = 'individual' then "expense_nature_rules"."expense_member_id" is not null else "expense_nature_rules"."expense_member_id" is null end)
);
--> statement-breakpoint
ALTER TABLE "expense_nature_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "expense_nature" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "expense_member_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "expense_nature_source" text;--> statement-breakpoint
ALTER TABLE "expense_nature_rules" ADD CONSTRAINT "expense_nature_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_nature_rules" ADD CONSTRAINT "expense_nature_rules_expense_member_id_household_members_id_fk" FOREIGN KEY ("expense_member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_nature_rules" ADD CONSTRAINT "expense_nature_rules_created_by_member_id_household_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_nature_rules_household_merchant_idx" ON "expense_nature_rules" USING btree ("household_id","merchant_name");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expense_member_id_household_members_id_fk" FOREIGN KEY ("expense_member_id") REFERENCES "public"."household_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_expense_member_check" CHECK (case when "transactions"."expense_nature" = 'individual' then "transactions"."expense_member_id" is not null else "transactions"."expense_member_id" is null end);--> statement-breakpoint
UPDATE "transactions" SET "expense_nature" = 'household', "expense_nature_source" = 'automatic'
WHERE "expense_nature_source" IS NULL
  AND "category_id" IN (SELECT "id" FROM "categories" WHERE "slug" IN ('moradia', 'energia', 'agua', 'supermercado'));
