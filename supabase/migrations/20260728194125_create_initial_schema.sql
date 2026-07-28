/*
# Create core dispatch verification schema

## Overview
Sets up the three tables the Mewar Distribution Centre app depends on:
users, summaries, and products. The app uses a custom username/password
login (NOT Supabase Auth) and all frontend queries run with the anon key,
so RLS policies must allow the anon role full CRUD.

## 1. New Tables

### users
- id (uuid, primary key)
- username (text, unique, not null) — login name
- role (text, not null) — 'admin' or 'uploader'
- password (text, not null) — plain-text password (matches existing app logic)
- created_at (timestamptz, default now())

### summaries
- id (uuid, primary key)
- title (text, not null) — dispatch summary name
- status (text, not null, default 'in_progress') — 'in_progress' or 'done'
- uploaded_by (text, nullable) — username of the uploader
- shared_with_uploaders (boolean, nullable) — admin sharing toggle
- finalized_at (timestamptz, nullable) — when verification was completed (grace-period reopen window)
- created_at (timestamptz, default now())

### products
- id (uuid, primary key)
- summary_id (uuid, not null, references summaries on delete cascade)
- barcode (text, nullable)
- product_name (text, nullable)
- required_mrp (numeric, nullable)
- required_box (numeric, nullable)
- required_pcs (numeric, nullable)
- completed_mrp (numeric, nullable)
- completed_box (numeric, nullable)
- completed_pcs (numeric, nullable)
- status (text, not null, default 'pending') — pending/match/short/excess/removed
- change_note (text, nullable)
- created_at (timestamptz, default now())

## 2. Security (RLS)
- RLS enabled on all three tables.
- All tables allow anon + authenticated full CRUD because the app uses a
  custom login flow and the anon-key client must be able to read and write.
  This is an intentionally shared single-tenant dataset.

## 3. Seed Data
- Inserts a default admin user (username: admin, password: admin123) if none exists.
*/

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'uploader',
  password text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  uploaded_by text,
  shared_with_uploaders boolean,
  finalized_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id uuid NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  barcode text,
  product_name text,
  required_mrp numeric,
  required_box numeric,
  required_pcs numeric,
  completed_mrp numeric,
  completed_box numeric,
  completed_pcs numeric,
  status text NOT NULL DEFAULT 'pending',
  change_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS products_summary_id_idx ON products(summary_id);

-- users policies (anon + authenticated)
DROP POLICY IF EXISTS "anon_select_users" ON users;
CREATE POLICY "anon_select_users" ON users FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_users" ON users;
CREATE POLICY "anon_insert_users" ON users FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_users" ON users;
CREATE POLICY "anon_update_users" ON users FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_users" ON users;
CREATE POLICY "anon_delete_users" ON users FOR DELETE
  TO anon, authenticated USING (true);

-- summaries policies (anon + authenticated)
DROP POLICY IF EXISTS "anon_select_summaries" ON summaries;
CREATE POLICY "anon_select_summaries" ON summaries FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_summaries" ON summaries;
CREATE POLICY "anon_insert_summaries" ON summaries FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_summaries" ON summaries;
CREATE POLICY "anon_update_summaries" ON summaries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_summaries" ON summaries;
CREATE POLICY "anon_delete_summaries" ON summaries FOR DELETE
  TO anon, authenticated USING (true);

-- products policies (anon + authenticated)
DROP POLICY IF EXISTS "anon_select_products" ON products;
CREATE POLICY "anon_select_products" ON products FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_products" ON products;
CREATE POLICY "anon_insert_products" ON products FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_products" ON products;
CREATE POLICY "anon_update_products" ON products FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_products" ON products;
CREATE POLICY "anon_delete_products" ON products FOR DELETE
  TO anon, authenticated USING (true);

-- Seed default admin user
INSERT INTO users (username, role, password)
VALUES ('admin', 'admin', 'admin123')
ON CONFLICT (username) DO NOTHING;
