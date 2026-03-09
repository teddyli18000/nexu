CREATE TABLE "workspace_memberships" (
	"pk" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"nexu_user_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"status" text DEFAULT 'active',
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "workspace_memberships_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "nexu_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memberships_team_user_idx" ON "workspace_memberships" USING btree ("slack_team_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_nexu_user_idx" ON "workspace_memberships" USING btree ("nexu_user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_bot_idx" ON "workspace_memberships" USING btree ("bot_id");--> statement-breakpoint
CREATE INDEX "artifacts_owner_user_id_idx" ON "artifacts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "sessions_nexu_user_id_idx" ON "sessions" USING btree ("nexu_user_id");