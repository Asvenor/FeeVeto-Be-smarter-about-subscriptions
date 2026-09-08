CREATE TABLE IF NOT EXISTS billing_entitlements (
  clerk_user_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('active', 'refunded', 'revoked')),
  product_key TEXT NOT NULL,
  price_id TEXT NOT NULL,
  amount_total INTEGER NOT NULL CHECK (amount_total >= 0),
  currency TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS billing_entitlements_payment_intent
  ON billing_entitlements (stripe_payment_intent_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
