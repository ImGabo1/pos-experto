import "dotenv/config";
import express from "express";
import cors from "cors";
import { q, initDb } from "./db";
import { seed } from "./seed";
import { priceCart, processSale, processReturn, suggestProduct, suggestCombo, dashboard, ask } from "./engine";

const allowedOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const app = express();
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());
console.log("CORS permitido para:", allowedOrigins.length ? allowedOrigins.join(", ") : "TODOS los orígenes");

const h = (fn: (req: express.Request) => Promise<any>) => async (req: express.Request, res: express.Response) => {
  try { res.json(await fn(req)); } catch (e: any) { res.status(400).json({ error: e.message ?? "Error" }); }
};

app.get("/", (_req, res) => res.send("POS experto API OK"));
app.get("/api/health", h(async () => ({ ok: true, cors: allowedOrigins.length ? allowedOrigins : "*" })));
app.get("/api/dashboard", h(() => dashboard()));

app.get("/api/products", h(async () => (await q("SELECT * FROM products ORDER BY id")).rows));
app.post("/api/products/suggest", h(async (r) => suggestProduct(r.body)));
app.post("/api/products", h(async (r) => {
  const { name, category, cost, price, stock, expires_at } = r.body;
  const s = await suggestProduct({ name, category, cost: Number(cost) });
  return (await q("INSERT INTO products(name,category,cost,price,stock,expires_at,trace) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [name, category, cost, price ?? s.price, stock ?? 0, expires_at || null, s.trace])).rows[0];
}));

app.get("/api/combos", h(async () => (await q("SELECT * FROM combos ORDER BY id")).rows));
app.post("/api/combos/suggest", h(async (r) => suggestCombo(r.body.product_ids)));
app.post("/api/combos", h(async (r) => {
  const s = await suggestCombo(r.body.product_ids);
  const pct = r.body.discount_percent ?? s.discount_percent;
  return (await q("INSERT INTO combos(name,discount_percent,product_ids,trace) VALUES($1,$2,$3,$4) RETURNING *", [r.body.name, pct, r.body.product_ids, s.trace])).rows[0];
}));

app.post("/api/sales/preview", h(async (r) => priceCart(r.body.items)));
app.post("/api/sales", h(async (r) => processSale(r.body.items)));
app.get("/api/invoices", h(async () => (await q(
  `SELECT i.*, COALESCE(json_agg(json_build_object('id',ii.id,'name',p.name,'qty',ii.qty,'returned_qty',ii.returned_qty,'discount',ii.discount,'unit_price',ii.unit_price) ORDER BY ii.id),'[]') items
   FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id JOIN products p ON p.id=ii.product_id GROUP BY i.id ORDER BY i.id DESC LIMIT 30`)).rows));

app.post("/api/returns", h(async (r) => processReturn(Number(r.body.invoice_item_id), Number(r.body.qty))));
app.get("/api/returns", h(async () => (await q("SELECT * FROM returns ORDER BY id DESC LIMIT 30")).rows));

app.get("/api/rules", h(async () => (await q("SELECT * FROM rules ORDER BY id")).rows));
app.post("/api/rules", h(async (r) => (await q("INSERT INTO rules(kind,params,description) VALUES($1,$2,$3) RETURNING *", [r.body.kind, r.body.params, r.body.description])).rows[0]));
app.patch("/api/rules/:id/toggle", h(async (r) => (await q("UPDATE rules SET active = NOT active WHERE id=$1 RETURNING *", [r.params.id])).rows[0]));

app.post("/api/ask", h(async (r) => ({ answer: await ask(String(r.body.question ?? "")) })));

const port = Number(process.env.PORT ?? 8000);
initDb().then(seed).then(() => app.listen(port, "0.0.0.0", () => console.log("API en puerto", port)))
  .catch((e) => { console.error("Fallo al iniciar:", e); process.exit(1); });
