export const migration = `
CREATE TABLE IF NOT EXISTS pool (
  id integer PRIMARY KEY CHECK (id = 1),
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  round bigint NOT NULL DEFAULT 1 CHECK (round > 0)
);
INSERT INTO pool(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS settlements (
  bet_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  stake bigint NOT NULL CHECK (stake > 0),
  contribution bigint NOT NULL CHECK (contribution >= 0),
  round bigint NOT NULL CHECK (round > 0),
  pool_before bigint NOT NULL CHECK (pool_before >= 0),
  won boolean NOT NULL,
  draw integer NOT NULL CHECK (draw BETWEEN 0 AND 99),
  algorithm text NOT NULL,
  payout bigint NOT NULL CHECK (payout >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (won OR payout = 0),
  CHECK (won = (draw = 0))
);
CREATE INDEX IF NOT EXISTS settlements_round_idx ON settlements(round);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_one_winner_per_round_idx ON settlements(round) WHERE won;
`;
