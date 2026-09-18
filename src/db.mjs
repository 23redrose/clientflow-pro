import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(process.env.DB_PATH || "data/clientflow.sqlite");
mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  plan_status TEXT NOT NULL DEFAULT 'trialing', stripe_customer_id TEXT,
  stripe_subscription_id TEXT, trial_ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  brand_color TEXT NOT NULL DEFAULT '#0B695F', logo_url TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  reminder_hours INTEGER NOT NULL DEFAULT 48, invoice_reminder_days INTEGER NOT NULL DEFAULT 3,
  email_enabled INTEGER NOT NULL DEFAULT 1, sms_enabled INTEGER NOT NULL DEFAULT 1,
  appointment_message TEXT NOT NULL, invoice_message TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL, field_type TEXT NOT NULL, required INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
  email_opt_in INTEGER NOT NULL DEFAULT 1, sms_opt_in INTEGER NOT NULL DEFAULT 1,
  custom_data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS clients_org_idx ON clients(organization_id, last_name);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT, location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'scheduled',
  confirmation_token TEXT NOT NULL UNIQUE, reminder_sent_at TEXT,
  confirmed_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS appointments_due_idx ON appointments(status, starts_at, reminder_sent_at);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  reference TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'EUR',
  due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reminder_sent_at TEXT,
  paid_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, reference)
);
CREATE INDEX IF NOT EXISTS invoices_due_idx ON invoices(status, due_date, reminder_sent_at);
CREATE TABLE IF NOT EXISTS message_logs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL, channel TEXT NOT NULL,
  kind TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL,
  provider_id TEXT, error TEXT, sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS client_files (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
  content BLOB NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS client_files_client_idx ON client_files(organization_id,client_id,created_at);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT, payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

// Migrations compatibles avec les bases déjà en production.
for (const statement of [
  "ALTER TABLE invoices ADD COLUMN document_type TEXT NOT NULL DEFAULT 'invoice'",
  "ALTER TABLE invoices ADD COLUMN description TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE invoices ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN notes TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE settings ADD COLUMN legal_name TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE settings ADD COLUMN legal_address TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE settings ADD COLUMN siret TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE settings ADD COLUMN vat_number TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE settings ADD COLUMN iban TEXT NOT NULL DEFAULT ''"
  ,"ALTER TABLE settings ADD COLUMN payment_terms TEXT NOT NULL DEFAULT 'Paiement à réception'"
  ,"ALTER TABLE settings ADD COLUMN support_email TEXT NOT NULL DEFAULT ''"
]) {
  try { db.exec(statement); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
}

// La version commerciale inclut un essai unique de 10 jours, y compris pour
// les comptes d'essai créés avant cette mise à jour.
db.exec("UPDATE organizations SET trial_ends_at=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+10 days') WHERE plan_status='trialing' AND julianday(trial_ends_at)>julianday(created_at,'+10 days')");

export function one(sql, params = []) { return db.prepare(sql).get(...params); }
export function all(sql, params = []) { return db.prepare(sql).all(...params); }
export function run(sql, params = []) { return db.prepare(sql).run(...params); }
export function transaction(fn) { db.exec("BEGIN IMMEDIATE"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
export function json(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }
