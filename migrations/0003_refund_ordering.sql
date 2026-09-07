-- A refund can arrive before checkout completion, or completion can be redelivered.
CREATE TABLE IF NOT EXISTS stripe_refunded_payments (
  payment_intent_id TEXT PRIMARY KEY,
  refunded_at TEXT NOT NULL
);
