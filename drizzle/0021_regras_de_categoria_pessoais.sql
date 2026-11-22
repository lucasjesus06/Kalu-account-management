ALTER TABLE "category_rules" ALTER COLUMN "household_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "owner_member_id" uuid;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_owner_member_id_household_members_id_fk" FOREIGN KEY ("owner_member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_owner_merchant_idx" ON "category_rules" USING btree ("owner_member_id","merchant_name");--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_owner_check" CHECK (("category_rules"."household_id" is not null)::int + ("category_rules"."owner_member_id" is not null)::int = 1);