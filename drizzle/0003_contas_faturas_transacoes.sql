CREATE TABLE "credit_card_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"due_date" date NOT NULL,
	"total_cents" bigint NOT NULL,
	"minimum_payment_cents" bigint,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_card_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"number_last4" text,
	"currency" text NOT NULL,
	"balance_cents" bigint NOT NULL,
	"credit_limit_cents" bigint,
	"credit_available_cents" bigint,
	"credit_used_cents" bigint,
	"card_brand" text,
	"last_bill_due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"accounts_count" integer DEFAULT 0 NOT NULL,
	"bills_count" integer DEFAULT 0 NOT NULL,
	"transactions_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"bill_id" uuid,
	"bill_external_id" text,
	"installment_number" integer,
	"installment_total" integer,
	"provider_category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_card_bills" ADD CONSTRAINT "credit_card_bills_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bill_id_credit_card_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."credit_card_bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_card_bills_account_external_idx" ON "credit_card_bills" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_connection_external_idx" ON "financial_accounts" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_started_idx" ON "sync_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_external_idx" ON "transactions" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "transactions_account_occurred_idx" ON "transactions" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_bill_idx" ON "transactions" USING btree ("bill_id");