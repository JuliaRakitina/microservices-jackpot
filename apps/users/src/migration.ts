/** Service-owned schema. Apply through Database.migrate; never schema synchronization. */
export const migration = `
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  delta bigint NOT NULL CHECK (delta <> 0),
  balance bigint NOT NULL CHECK (balance >= 0),
  reference text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_sequence_idx ON ledger(user_id, sequence);
CREATE TABLE IF NOT EXISTS credits (
  user_id uuid NOT NULL REFERENCES profiles(id),
  key text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS reservations (
  bet_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  key text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'reserved', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settlement_receipts (
  bet_id uuid PRIMARY KEY REFERENCES reservations(bet_id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  won boolean NOT NULL,
  payout bigint NOT NULL CHECK (payout >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (won OR payout = 0)
);
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are append-only';
END;
$$;
DROP TRIGGER IF EXISTS ledger_append_only ON ledger;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
`;
