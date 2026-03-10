-- Rename tables
ALTER TABLE "slack_user_claims" RENAME TO "workspace_memberships";
ALTER TABLE "slack_claim_keys" RENAME TO "claim_tokens";

-- Rename columns
ALTER TABLE "workspace_memberships" RENAME COLUMN "slack_user_id" TO "im_user_id";
ALTER TABLE "claim_tokens" RENAME COLUMN "slack_user_id" TO "im_user_id";
ALTER TABLE "claim_tokens" RENAME COLUMN "key" TO "token";

-- Rename indexes and constraints
ALTER INDEX "slack_user_claims_id_unique" RENAME TO "workspace_memberships_id_unique";
ALTER INDEX "slack_user_claims_team_user_idx" RENAME TO "workspace_memberships_team_user_idx";
ALTER INDEX "slack_user_claims_auth_user_idx" RENAME TO "workspace_memberships_auth_user_idx";
ALTER INDEX "slack_claim_keys_id_unique" RENAME TO "claim_tokens_id_unique";
ALTER INDEX "slack_claim_keys_key_unique" RENAME TO "claim_tokens_token_unique";
ALTER INDEX "slack_claim_keys_team_user_idx" RENAME TO "claim_tokens_team_user_idx";
