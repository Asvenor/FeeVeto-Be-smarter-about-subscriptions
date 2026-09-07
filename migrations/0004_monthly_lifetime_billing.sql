-- Additive only. Keep legacy lifetime purchases and saved audits unchanged.
CREATE TABLE IF NOT EXISTS billing_customers (
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  clerk_user_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  checkout_token TEXT,
  checkout_plan TEXT CHECK (checkout_plan IN ('monthly', 'lifetime')),
  checkout_session_id TEXT,
  checkout_expires_at INTEGER,
  checkout_origin TEXT,
  PRIMARY KEY (mode, clerk_user_id),
  UNIQUE (mode, stripe_customer_id)
);
CREATE TABLE IF NOT EXISTS billing_purchases (
  mode TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  amount_total INTEGER NOT NULL,
  currency TEXT NOT NULL,
  purchased_at INTEGER NOT NULL,
  PRIMARY KEY (mode, payment_intent_id),
  UNIQUE (mode, session_id)
);
CREATE INDEX IF NOT EXISTS billing_purchases_owner ON billing_purchases(mode, clerk_user_id);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  mode TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  current_period_end INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mode, subscription_id)
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_owner ON billing_subscriptions(mode, clerk_user_id);
CREATE TABLE IF NOT EXISTS billing_paid_invoices (
  mode TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  paid_through INTEGER NOT NULL,
  PRIMARY KEY (mode, invoice_id)
);
CREATE TABLE IF NOT EXISTS billing_invoice_payments (
  mode TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  PRIMARY KEY (mode, invoice_id, payment_intent_id)
);
