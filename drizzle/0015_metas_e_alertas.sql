CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"month" text NOT NULL,
	"threshold" integer NOT NULL,
	"consumed_cents" bigint NOT NULL,
	"limit_cents" bigint NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "budget_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid,
	"expense_nature" text,
	"expense_member_id" uuid,
	"limit_cents" bigint NOT NULL,
	"alert_thresholds" integer[] DEFAULT '{70,90,100}' NOT NULL,
	"starts_month" text NOT NULL,
	"ends_month" text,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_goals_limit_check" CHECK ("budget_goals"."limit_cents" > 0),
	CONSTRAINT "budget_goals_months_check" CHECK ("budget_goals"."starts_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and ("budget_goals"."ends_month" is null or ("budget_goals"."ends_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "budget_goals"."ends_month" >= "budget_goals"."starts_month"))),
	CONSTRAINT "budget_goals_member_check" CHECK (case when "budget_goals"."expense_nature" = 'individual' then "budget_goals"."expense_member_id" is not null else "budget_goals"."expense_member_id" is null end)
);
--> statement-breakpoint
ALTER TABLE "budget_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_goal_id_budget_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."budget_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_goals" ADD CONSTRAINT "budget_goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_goals" ADD CONSTRAINT "budget_goals_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_goals" ADD CONSTRAINT "budget_goals_expense_member_id_household_members_id_fk" FOREIGN KEY ("expense_member_id") REFERENCES "public"."household_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_goals" ADD CONSTRAINT "budget_goals_created_by_member_id_household_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alerts_goal_month_threshold_idx" ON "budget_alerts" USING btree ("goal_id","month","threshold");--> statement-breakpoint
CREATE INDEX "budget_goals_household_idx" ON "budget_goals" USING btree ("household_id");