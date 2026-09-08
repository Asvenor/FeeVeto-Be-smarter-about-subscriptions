-- Additive owner controls. New purchases remain paused until explicitly enabled.
-- Test and live settings/codes never share a row. Existing entitlements are untouched.
CREATE TABLE IF NOT EXISTS owner_settings (
  mode TEXT PRIMARY KEY CHECK (mode IN ('test', 'live')),
  accept_new_purchases INTEGER NOT NULL DEFAULT 0 CHECK (accept_new_purchases IN (0, 1)),
  monthly_enabled INTEGER NOT NULL DEFAULT 1 CHECK (monthly_enabled IN (0, 1)),
  lifetime_enabled INTEGER NOT NULL DEFAULT 1 CHECK (lifetime_enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at INTEGER,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS owner_settings_history (
  mode TEXT NOT NULL,
  revision INTEGER NOT NULL,
  accept_new_purchases INTEGER NOT NULL,
  monthly_enabled INTEGER NOT NULL,
  lifetime_enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (mode, revision)
);
CREATE TRIGGER IF NOT EXISTS owner_settings_audit AFTER UPDATE ON owner_settings
BEGIN
  INSERT INTO owner_settings_history
    (mode, revision, accept_new_purchases, monthly_enabled, lifetime_enabled, updated_at, updated_by)
  VALUES (NEW.mode, NEW.revision, NEW.accept_new_purchases, NEW.monthly_enabled,
    NEW.lifetime_enabled, NEW.updated_at, NEW.updated_by);
END;

CREATE TABLE IF NOT EXISTS owner_discounts (
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  code TEXT NOT NULL,
  percent_off INTEGER NOT NULL CHECK (percent_off BETWEEN 1 AND 80),
  plan TEXT NOT NULL CHECK (plan IN ('monthly', 'lifetime', 'both')),
  duration TEXT NOT NULL CHECK (duration IN ('once', 'forever')),
  expires_at INTEGER,
  max_redemptions INTEGER,
  products_json TEXT NOT NULL DEFAULT '[]',
  coupon_id TEXT NOT NULL,
  promotion_code_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'active', 'deactivating', 'inactive')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (mode, id),
  UNIQUE (mode, request_id),
  UNIQUE (mode, code),
  UNIQUE (mode, coupon_id),
  UNIQUE (mode, promotion_code_id)
);
CREATE TABLE IF NOT EXISTS owner_discount_history (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  discount_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS owner_discount_created AFTER INSERT ON owner_discounts
BEGIN
  INSERT INTO owner_discount_history (mode, discount_id, status, updated_at, updated_by)
  VALUES (NEW.mode, NEW.id, NEW.status, NEW.updated_at, NEW.updated_by);
END;
CREATE TRIGGER IF NOT EXISTS owner_discount_status_changed AFTER UPDATE OF status ON owner_discounts
WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO owner_discount_history (mode, discount_id, status, updated_at, updated_by)
  VALUES (NEW.mode, NEW.id, NEW.status, NEW.updated_at, NEW.updated_by);
END;
