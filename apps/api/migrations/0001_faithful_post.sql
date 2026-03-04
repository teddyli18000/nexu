CREATE TABLE "bot_feature_flags" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"bot_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"rollout_percentage" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "bot_feature_flags_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bot_feature_flags_bot_feature_key_idx" ON "bot_feature_flags" USING btree ("bot_id","feature_key");