-- Licenses table for one-off $149 AUD lifetime license
CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount_aud INTEGER NOT NULL DEFAULT 14900,
  UNIQUE(user_id)
);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- Users can read their own license
CREATE POLICY "Users read own license"
  ON licenses FOR SELECT
  USING (auth.uid() = user_id);

-- Only service_role (webhook edge function) can insert/update
CREATE POLICY "Service role manages licenses"
  ON licenses FOR ALL
  USING (auth.role() = 'service_role');
