CREATE TABLE "slack_claim_keys" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"key" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"slack_user_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"claimed_by" text,
	"created_at" text NOT NULL,
	CONSTRAINT "slack_claim_keys_id_unique" UNIQUE("id"),
	CONSTRAINT "slack_claim_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "slack_claim_keys_team_user_idx" ON "slack_claim_keys" USING btree ("team_id","slack_user_id");
