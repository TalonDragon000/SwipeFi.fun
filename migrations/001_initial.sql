CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS weekly_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  epoch_id text NOT NULL,
  execution_provider text NOT NULL DEFAULT 'ZERO_EX'
    CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP')),
  status text NOT NULL CHECK (
    status IN (
      'OPEN', 'SWIPING', 'REVIEW', 'AWAITING_SIGNATURE',
      'SUBMITTED', 'SETTLED', 'PARTIAL', 'FAILED', 'CLOSED'
    )
  ),
  execution_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet, epoch_id, execution_provider)
);

CREATE TABLE IF NOT EXISTS executions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES weekly_sessions(id),
  authorized_plan_hash text NOT NULL,
  execution_provider text NOT NULL DEFAULT 'ZERO_EX'
    CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP')),
  plan jsonb NOT NULL,
  status text NOT NULL CHECK (
    status IN ('PREPARED', 'SUBMITTED', 'SETTLED', 'PARTIAL', 'FAILED')
  ),
  transaction_hashes text[] NOT NULL DEFAULT '{}',
  submission_mode text NOT NULL DEFAULT 'SEQUENTIAL' CHECK (submission_mode IN ('SEQUENTIAL', 'BATCH')),
  settled_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id),
  UNIQUE (authorized_plan_hash)
);

ALTER TABLE weekly_sessions
  DROP CONSTRAINT IF EXISTS weekly_sessions_execution_id_fkey;

ALTER TABLE weekly_sessions
  ADD CONSTRAINT weekly_sessions_execution_id_fkey
  FOREIGN KEY (execution_id) REFERENCES executions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS executions_status_idx ON executions(status);

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS settled_outputs jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS submission_mode text NOT NULL DEFAULT 'SEQUENTIAL'
  CHECK (submission_mode IN ('SEQUENTIAL', 'BATCH'));

ALTER TABLE weekly_sessions
  ADD COLUMN IF NOT EXISTS execution_provider text NOT NULL DEFAULT 'ZERO_EX'
  CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP'));

ALTER TABLE weekly_sessions
  DROP CONSTRAINT IF EXISTS weekly_sessions_wallet_epoch_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS weekly_sessions_wallet_epoch_provider_idx
  ON weekly_sessions(wallet, epoch_id, execution_provider);

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS execution_provider text NOT NULL DEFAULT 'ZERO_EX'
  CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP'));

UPDATE executions
SET execution_provider = CASE
  WHEN plan->>'provider' IN ('ZERO_EX', 'UNISWAP') THEN plan->>'provider'
  WHEN plan#>>'{quotes,0,routing}' = 'ZERO_EX' THEN 'ZERO_EX'
  WHEN plan#>>'{quotes,0,routing}' IN (
    'CLASSIC', 'WRAP', 'UNWRAP', 'DUTCH_V2', 'DUTCH_V3', 'PRIORITY'
  ) THEN 'UNISWAP'
  ELSE execution_provider
END;

CREATE TABLE IF NOT EXISTS human_verifications (
  wallet text PRIMARY KEY CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  nullifier_digest text NOT NULL UNIQUE CHECK (nullifier_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_preferences (
  wallet text PRIMARY KEY CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  execution_provider text NOT NULL DEFAULT 'ZERO_EX'
    CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP')),
  preferences jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Parallel Solana/Jupiter execution. Existing rows remain Robinhood records.
ALTER TABLE weekly_sessions
  ADD COLUMN IF NOT EXISTS owner_id text,
  ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'ROBINHOOD',
  ADD COLUMN IF NOT EXISTS feed_ranking_provider text NOT NULL DEFAULT 'ZERO_G';

ALTER TABLE executions
  ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'ROBINHOOD';

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS owner_id text;

ALTER TABLE weekly_sessions
  DROP CONSTRAINT IF EXISTS weekly_sessions_wallet_check,
  DROP CONSTRAINT IF EXISTS weekly_sessions_execution_provider_check,
  DROP CONSTRAINT IF EXISTS weekly_sessions_feed_ranking_provider_check,
  DROP CONSTRAINT IF EXISTS weekly_sessions_chain_check;

ALTER TABLE weekly_sessions
  ADD CONSTRAINT weekly_sessions_wallet_check CHECK (
    wallet ~ '^0x[0-9a-f]{40}$' OR wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  ADD CONSTRAINT weekly_sessions_execution_provider_check
    CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP', 'JUPITER')),
  ADD CONSTRAINT weekly_sessions_feed_ranking_provider_check
    CHECK (feed_ranking_provider IN ('ZERO_G', 'DETERMINISTIC')),
  ADD CONSTRAINT weekly_sessions_chain_check
    CHECK (chain IN ('ROBINHOOD', 'SOLANA'));

ALTER TABLE executions
  DROP CONSTRAINT IF EXISTS executions_execution_provider_check,
  DROP CONSTRAINT IF EXISTS executions_chain_check;

ALTER TABLE executions
  ADD CONSTRAINT executions_execution_provider_check
    CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP', 'JUPITER')),
  ADD CONSTRAINT executions_chain_check
    CHECK (chain IN ('ROBINHOOD', 'SOLANA'));

ALTER TABLE user_preferences
  DROP CONSTRAINT IF EXISTS user_preferences_wallet_check,
  DROP CONSTRAINT IF EXISTS user_preferences_execution_provider_check;

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_wallet_check CHECK (
    wallet ~ '^0x[0-9a-f]{40}$' OR wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  ADD CONSTRAINT user_preferences_execution_provider_check
    CHECK (execution_provider IN ('ZERO_EX', 'UNISWAP', 'JUPITER'));

DROP INDEX IF EXISTS weekly_sessions_wallet_epoch_provider_idx;
DROP INDEX IF EXISTS weekly_sessions_wallet_epoch_chain_provider_idx;
CREATE UNIQUE INDEX IF NOT EXISTS weekly_sessions_wallet_epoch_chain_provider_ranker_idx
  ON weekly_sessions(
    wallet, epoch_id, chain, execution_provider, feed_ranking_provider
  );

CREATE TABLE IF NOT EXISTS asset_metadata_cache (
  cache_key text PRIMARY KEY,
  provider text NOT NULL,
  snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_metadata_cache_expiry_idx
  ON asset_metadata_cache(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_owner_id_idx
  ON user_preferences(owner_id) WHERE owner_id IS NOT NULL;

UPDATE weekly_sessions SET owner_id = wallet WHERE owner_id IS NULL;
UPDATE user_preferences SET owner_id = wallet WHERE owner_id IS NULL;
