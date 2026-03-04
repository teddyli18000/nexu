-- Intentionally manual SQL for demo mismatch scenario.
-- This migration does not contain the schema change added in TypeScript schema.

CREATE INDEX IF NOT EXISTS "bot_feature_flags_status_idx"
  ON "bot_feature_flags" USING btree ("status");
