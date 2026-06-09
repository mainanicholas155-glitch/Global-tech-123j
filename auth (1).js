// ============================================================
//  db/init.js — Database Schema & Initialization
//  Run once: node db/init.js
// ============================================================
'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const bcrypt   = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || './db/globalchat.db';
const dir     = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA ────────────────────────────────────────────────────
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    full_name         TEXT NOT NULL,
    email             TEXT UNIQUE NOT NULL,
    password_hash     TEXT NOT NULL,
    phone             TEXT NOT NULL,
    country           TEXT NOT NULL,
    language_1        TEXT NOT NULL,
    language_2        TEXT NOT NULL,
    email_verified    INTEGER DEFAULT 0,
    payment_status    TEXT DEFAULT 'pending',   -- pending | paid
    training_status   TEXT DEFAULT 'not_started', -- not_started | in_progress | completed
    training_progress INTEGER DEFAULT 0,
    account_status    TEXT DEFAULT 'inactive',  -- inactive | active | suspended
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
  );

  -- Payments table
  CREATE TABLE IF NOT EXISTS payments (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id),
    phone_number          TEXT NOT NULL,
    amount                REAL NOT NULL,
    merchant_request_id   TEXT UNIQUE,
    checkout_request_id   TEXT UNIQUE,
    mpesa_receipt_number  TEXT,
    transaction_date      TEXT,
    payment_status        TEXT DEFAULT 'pending',  -- pending | success | failed | cancelled | timeout
    result_code           INTEGER,
    result_desc           TEXT,
    raw_callback          TEXT,
    created_at            TEXT DEFAULT (datetime('now')),
    updated_at            TEXT DEFAULT (datetime('now'))
  );

  -- Payment audit log
  CREATE TABLE IF NOT EXISTS payment_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id    TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    event_data    TEXT,
    ip_address    TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- Admin users
  CREATE TABLE IF NOT EXISTS admin_users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT DEFAULT 'admin',
    created_at    TEXT DEFAULT (datetime('now'))
  );

  -- Sessions / JWT blocklist (for logout)
  CREATE TABLE IF NOT EXISTS token_blocklist (
    jti        TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Indexes for fast lookups
  CREATE INDEX IF NOT EXISTS idx_payments_user          ON payments(user_id);
  CREATE INDEX IF NOT EXISTS idx_payments_checkout_id   ON payments(checkout_request_id);
  CREATE INDEX IF NOT EXISTS idx_payments_merchant_id   ON payments(merchant_request_id);
  CREATE INDEX IF NOT EXISTS idx_payments_status        ON payments(payment_status);
  CREATE INDEX IF NOT EXISTS idx_users_email            ON users(email);
  CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id);
`);

// ── SEED ADMIN USER ──────────────────────────────────────────
const adminEmail = process.env.ADMIN_EMAIL || 'admin@globalchat.com';
const adminPass  = process.env.ADMIN_PASSWORD || 'Admin@2024!';
const existing   = db.prepare('SELECT id FROM admin_users WHERE email = ?').get(adminEmail);

if (!existing) {
  const { v4: uuidv4 } = require('uuid');
  const hash = bcrypt.hashSync(adminPass, 12);
  db.prepare(`
    INSERT INTO admin_users (id, email, password_hash) VALUES (?, ?, ?)
  `).run(uuidv4(), adminEmail, hash);
  console.log(`✅ Admin user created: ${adminEmail}`);
}

console.log('✅ Database initialized successfully at', DB_PATH);
db.close();

module.exports = db;
