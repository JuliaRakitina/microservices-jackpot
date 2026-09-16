/** Auth owns credentials only; roles and balances belong to Users. */
export const migration = `
CREATE TABLE IF NOT EXISTS auth_identities (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_pending_idx ON auth_identities (created_at) WHERE state = 'pending';
`;
