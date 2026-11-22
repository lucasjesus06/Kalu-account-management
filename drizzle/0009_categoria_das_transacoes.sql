ALTER TABLE "transactions" ADD COLUMN "merchant_name" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_source" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id");