export const migration = `
CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  key text NOT NULL,
  state text NOT NULL CHECK (state IN ('funds_pending', 'accepted', 'won', 'lost', 'rejected')),
  payout bigint NOT NULL DEFAULT 0 CHECK (payout >= 0),
  rejection_reason text,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key),
  CHECK (state = 'won' OR payout = 0)
);
CREATE INDEX IF NOT EXISTS bets_state_updated_idx ON bets(state, updated_at);
CREATE INDEX IF NOT EXISTS bets_user_created_idx ON bets(user_id, created_at);
`;
