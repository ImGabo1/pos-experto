import { Pool, types } from "pg";

types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC -> number
types.setTypeParser(1082, (v) => v);             // DATE -> "YYYY-MM-DD"

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/pos";
export const pool = new Pool({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
});
export const q = (text: string, params?: any[]) => pool.query(text, params);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  cost NUMERIC(12,2) NOT NULL, price NUMERIC(12,2) NOT NULL, stock INT NOT NULL DEFAULT 0,
  expires_at DATE, trace JSONB, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS combos(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, discount_percent NUMERIC(5,2) NOT NULL,
  product_ids INT[] NOT NULL, active BOOLEAN DEFAULT true, trace JSONB, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS rules(
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL, params JSONB NOT NULL,
  description TEXT, active BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS invoices(
  id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(),
  subtotal NUMERIC(12,2), discount NUMERIC(12,2), total NUMERIC(12,2), profit NUMERIC(12,2), trace JSONB);
CREATE TABLE IF NOT EXISTS invoice_items(
  id SERIAL PRIMARY KEY, invoice_id INT REFERENCES invoices(id), product_id INT REFERENCES products(id),
  qty INT, unit_price NUMERIC(12,2), unit_cost NUMERIC(12,2), discount NUMERIC(12,2) DEFAULT 0, returned_qty INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS returns(
  id SERIAL PRIMARY KEY, invoice_id INT, invoice_item_id INT, qty INT,
  approved BOOLEAN, amount NUMERIC(12,2), trace JSONB, created_at TIMESTAMPTZ DEFAULT now());
`;

export async function initDb() {
  await q(SCHEMA);
}
