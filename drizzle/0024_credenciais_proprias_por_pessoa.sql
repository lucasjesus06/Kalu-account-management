CREATE TABLE "pluggy_credentials" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pluggy_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pluggy_credentials" ADD CONSTRAINT "pluggy_credentials_member_id_household_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."household_members"("id") ON DELETE cascade ON UPDATE no action;