-- Credits balance per user (separate Sonnet and Opus pools)
CREATE TABLE credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sonnet_balance INTEGER NOT NULL DEFAULT 0,
  opus_balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Immutable transaction log for auditing
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK (model IN ('sonnet', 'opus')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  stripe_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: users can read their own data
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own credits"
  ON credits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users read own transactions"
  ON credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role (Edge Functions) can manage all rows
CREATE POLICY "Service role manages credits"
  ON credits FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role manages transactions"
  ON credit_transactions FOR ALL
  USING (auth.role() = 'service_role');

-- Index for efficient transaction lookups
CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
