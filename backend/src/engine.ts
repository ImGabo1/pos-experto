// Motor de inferencia del sistema experto.
// Base de conocimiento = tablas `rules`, `combos`, `products` e historial de `invoices`.
// Cada decisión devuelve una traza con el CÓMO (qué hice) y el POR QUÉ (qué regla lo justifica).
import { pool, q } from "./db";

export type Step = { rule: string; how: string; why: string };
export type Trace = { summary: string; steps: Step[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const MIN_MARGIN = 1.05; // regla de seguridad: nunca vender por debajo de costo + 5%
const today = () => Date.parse(new Date().toISOString().slice(0, 10));
const daysLeft = (d: string | null) => (d ? Math.round((Date.parse(d) - today()) / 864e5) : null);

// ---------- 1. VENTA: descuentos automáticos ----------
export async function priceCart(items: { product_id: number; qty: number }[], db: any = pool) {
  if (!items.length) throw new Error("El carrito está vacío");
  const prods = (await db.query("SELECT * FROM products WHERE id = ANY($1)", [items.map((i) => i.product_id)])).rows;
  const rules = (await db.query("SELECT * FROM rules WHERE active")).rows;
  const combos = (await db.query("SELECT * FROM combos WHERE active")).rows;
  const steps: Step[] = [];

  const lines = items.map((it) => {
    const p = prods.find((x: any) => x.id === it.product_id);
    if (!p) throw new Error(`El producto ${it.product_id} no existe`);
    if (!(it.qty >= 1)) throw new Error("Cantidad inválida");
    if (it.qty > p.stock) throw new Error(`Stock insuficiente de ${p.name} (quedan ${p.stock})`);
    const dl = daysLeft(p.expires_at);
    if (dl !== null && dl < 0) throw new Error(`${p.name} está vencido y no puede venderse`);
    return { p, qty: it.qty, dl, cands: [] as { pct: number; rule: string }[] };
  });

  for (const l of lines) {
    for (const r of rules) {
      const pr = r.params;
      if (r.kind === "qty_discount" && l.qty >= pr.min_qty && (!pr.category || pr.category === l.p.category))
        l.cands.push({ pct: pr.percent, rule: `Regla #${r.id} (${r.description ?? "descuento por cantidad"})` });
      if (r.kind === "expiry_discount" && l.dl !== null && l.dl <= pr.max_days)
        l.cands.push({ pct: pr.percent, rule: `Regla #${r.id} (${r.description ?? "descuento por vencimiento"}) — vence en ${l.dl} día(s)` });
    }
  }
  const present = new Set(lines.map((l) => l.p.id));
  for (const c of combos) {
    if (c.product_ids.every((id: number) => present.has(id)))
      lines.filter((l) => c.product_ids.includes(l.p.id)).forEach((l) =>
        l.cands.push({ pct: Number(c.discount_percent), rule: `Combo #${c.id} "${c.name}"` }));
  }

  const out = lines.map((l) => {
    let pct = l.cands.length ? Math.max(...l.cands.map((c) => c.pct)) : 0;
    const win = l.cands.find((c) => c.pct === pct);
    const base = l.p.price * l.qty;
    if (l.cands.length) {
      steps.push({
        rule: "Resolución de conflictos",
        how: `${l.p.name} x${l.qty}: candidatos ${l.cands.map((c) => `${c.pct}% por ${c.rule}`).join("; ")}. Se eligió ${pct}%.`,
        why: `Cuando varias reglas aplican al mismo producto no se acumulan: gana la de mayor porcentaje (${win?.rule}) para evitar descuentos excesivos.`,
      });
    }
    const maxPct = (1 - (l.p.cost * MIN_MARGIN) / l.p.price) * 100;
    if (pct > maxPct) {
      const capped = Math.max(0, Math.floor(maxPct * 10) / 10);
      steps.push({
        rule: "Protección de margen mínimo",
        how: `Descuento de ${l.p.name} reducido de ${pct}% a ${capped}%.`,
        why: `Costo ${l.p.cost} + 5% de margen mínimo = ${r2(l.p.cost * MIN_MARGIN)}; un precio menor generaría pérdida.`,
      });
      pct = capped;
    }
    const discount = r2((base * pct) / 100);
    return {
      product_id: l.p.id, name: l.p.name, qty: l.qty, unit_price: l.p.price, unit_cost: l.p.cost,
      pct, discount, total: r2(base - discount),
    };
  });

  const subtotal = r2(out.reduce((s, l) => s + l.unit_price * l.qty, 0));
  const discount = r2(out.reduce((s, l) => s + l.discount, 0));
  const total = r2(subtotal - discount);
  const profit = r2(total - out.reduce((s, l) => s + l.unit_cost * l.qty, 0));
  if (!steps.length)
    steps.push({ rule: "Sin reglas aplicables", how: "Ningún producto cumplió condiciones de descuento.", why: "No hay cantidad, vencimiento cercano ni combo completo en este carrito." });
  return { lines: out, subtotal, discount, total, profit, trace: { summary: `Venta con ${out.length} línea(s) y ${discount} de descuento automático`, steps } as Trace };
}

export async function processSale(items: { product_id: number; qty: number }[]) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const pc = await priceCart(items, c);
    const inv = (await c.query(
      "INSERT INTO invoices(subtotal,discount,total,profit,trace) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [pc.subtotal, pc.discount, pc.total, pc.profit, pc.trace])).rows[0];
    for (const l of pc.lines) {
      await c.query("INSERT INTO invoice_items(invoice_id,product_id,qty,unit_price,unit_cost,discount) VALUES($1,$2,$3,$4,$5,$6)",
        [inv.id, l.product_id, l.qty, l.unit_price, l.unit_cost, l.discount]);
      const u = await c.query("UPDATE products SET stock = stock - $1 WHERE id=$2 AND stock >= $1", [l.qty, l.product_id]);
      if (!u.rowCount) throw new Error(`Stock insuficiente de ${l.name}`);
    }
    await c.query("COMMIT");
    return { id: inv.id as number, ...pc };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// ---------- 2. DEVOLUCIONES ----------
export async function processReturn(invoice_item_id: number, qty: number) {
  const it = (await q(
    `SELECT ii.*, i.created_at AS inv_date, p.name, p.category, p.expires_at
     FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id JOIN products p ON p.id=ii.product_id WHERE ii.id=$1`,
    [invoice_item_id])).rows[0];
  if (!it) throw new Error("Ítem de factura no encontrado");
  const rules = (await q("SELECT * FROM rules WHERE active")).rows;
  const steps: Step[] = [];
  let ok = true;
  const fail = (rule: string, how: string, why: string) => { ok = false; steps.push({ rule, how: "RECHAZADA: " + how, why }); };
  const pass = (rule: string, how: string, why: string) => steps.push({ rule, how, why });

  const avail = it.qty - it.returned_qty;
  if (!(qty >= 1) || qty > avail) fail("Cantidad devolvible", `Se pidió devolver ${qty} y solo quedan ${avail} por devolver.`, "No se puede devolver más de lo vendido en la factura.");
  else pass("Cantidad devolvible", `Devolución de ${qty} de ${avail} disponibles.`, "La cantidad es coherente con lo vendido.");

  const age = (Date.now() - new Date(it.inv_date).getTime()) / 864e5;
  for (const r of rules) {
    if (r.kind === "return_window") {
      if (age > r.params.days) fail(`Regla #${r.id} (${r.description ?? "plazo de devolución"})`, `La factura tiene ${Math.floor(age)} días.`, `El plazo máximo es ${r.params.days} días.`);
      else pass(`Regla #${r.id} (plazo de devolución)`, `La factura tiene ${Math.floor(age)} días.`, `Está dentro del plazo de ${r.params.days} días.`);
    }
    if (r.kind === "non_returnable_category") {
      if (r.params.categories.includes(it.category)) fail(`Regla #${r.id} (${r.description ?? "categoría no retornable"})`, `${it.name} es de la categoría ${it.category}.`, `Las categorías ${r.params.categories.join(", ")} no admiten devolución por higiene/seguridad.`);
    }
  }
  const dl = daysLeft(it.expires_at);
  if (dl !== null && dl < 0) steps.push({ rule: "Producto vencido", how: "El producto devuelto ya venció, no vuelve al inventario.", why: "No se puede revender mercancía vencida." });

  const unitPaid = (it.unit_price * it.qty - it.discount) / it.qty;
  const amount = ok ? r2(unitPaid * qty) : 0;
  const trace: Trace = { summary: ok ? `Devolución aprobada de ${qty} x ${it.name}, reembolso ${amount}` : `Devolución rechazada de ${it.name}`, steps };
  if (ok) {
    steps.push({ rule: "Cálculo de reembolso", how: `Se reembolsa ${r2(unitPaid)} por unidad x ${qty} = ${amount}.`, why: "Se devuelve lo realmente pagado (precio menos el descuento automático que tuvo esa unidad)." });
    await q("UPDATE invoice_items SET returned_qty = returned_qty + $1 WHERE id=$2", [qty, invoice_item_id]);
    if (dl === null || dl >= 0) await q("UPDATE products SET stock = stock + $1 WHERE id=$2", [qty, it.product_id]);
  }
  const row = (await q("INSERT INTO returns(invoice_id,invoice_item_id,qty,approved,amount,trace) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [it.invoice_id, invoice_item_id, qty, ok, amount, trace])).rows[0];
  return { id: row.id as number, approved: ok, amount, trace };
}

// ---------- 3. REGISTRO DE PRODUCTO: recomendar precio y descuento máximo ----------
export async function suggestProduct(p: { name: string; category: string; cost: number }) {
  const same = (await q("SELECT cost, price FROM products WHERE category=$1", [p.category])).rows;
  const all = (await q("SELECT cost, price FROM products")).rows;
  const steps: Step[] = [];
  let margin: number;
  if (same.length) {
    margin = same.reduce((s: number, x: any) => s + (x.price - x.cost) / x.cost, 0) / same.length;
    steps.push({ rule: "Margen promedio de la categoría", how: `Se promedió el margen de ${same.length} producto(s) de "${p.category}": ${r2(margin * 100)}%.`, why: "Productos similares ya registrados indican qué margen tolera esta categoría; cada producto nuevo que se registre cambia este promedio." });
  } else if (all.length) {
    margin = all.reduce((s: number, x: any) => s + (x.price - x.cost) / x.cost, 0) / all.length;
    steps.push({ rule: "Margen promedio general", how: `La categoría "${p.category}" es nueva; se usó el margen promedio de todo el catálogo: ${r2(margin * 100)}%.`, why: "Sin datos de la categoría, el mejor estimador es el comportamiento global." });
  } else { margin = 0.3; steps.push({ rule: "Margen por defecto", how: "Catálogo vacío, margen 30%.", why: "No hay historial." }); }
  const price = r2(p.cost * (1 + margin));
  const maxDiscount = Math.floor(Math.min(25, (1 - (p.cost * MIN_MARGIN) / price) * 100 * 0.8) * 10) / 10;
  steps.push({ rule: "Precio sugerido", how: `${p.cost} x (1 + ${r2(margin * 100)}%) = ${price}.`, why: "Se aplica el margen esperado sobre el costo." });
  steps.push({ rule: "Descuento máximo recomendado", how: `Hasta ${maxDiscount}% de descuento.`, why: "Se deja un colchón: el precio nunca baja de costo + 5% y se usa solo el 80% del espacio disponible." });
  return { price, maxDiscount, trace: { summary: `Precio sugerido ${price} para ${p.name}`, steps } as Trace };
}

// ---------- 4. COMBOS: recomendar descuento ----------
export async function suggestCombo(ids: number[]) {
  if (ids.length < 2) throw new Error("Un combo necesita al menos 2 productos");
  const prods = (await q("SELECT * FROM products WHERE id = ANY($1)", [ids])).rows;
  const sumPrice = prods.reduce((s: number, p: any) => s + p.price, 0);
  const sumCost = prods.reduce((s: number, p: any) => s + p.cost, 0);
  const maxPct = (1 - (sumCost * MIN_MARGIN) / sumPrice) * 100;
  const co = (await q(
    `SELECT COUNT(*)::int n FROM (SELECT invoice_id FROM invoice_items WHERE product_id = ANY($1)
     GROUP BY invoice_id HAVING COUNT(DISTINCT product_id) = $2) t`, [ids, ids.length])).rows[0].n;
  const steps: Step[] = [
    { rule: "Espacio de descuento", how: `Precio normal ${r2(sumPrice)}, costo total ${r2(sumCost)}. Máximo descuento sin perder margen: ${r2(maxPct)}%.`, why: "El combo debe quedar por encima de costo + 5%." },
  ];
  let pct: number;
  if (co >= 2) { pct = maxPct * 0.4; steps.push({ rule: "Afinidad alta", how: `Estos productos ya se compraron juntos en ${co} factura(s); descuento = 40% del espacio.`, why: "Ya se venden juntos, un descuento pequeño basta." }); }
  else { pct = maxPct * 0.7; steps.push({ rule: "Afinidad baja", how: `Solo ${co} factura(s) los incluyen juntos; descuento = 70% del espacio.`, why: "Hace falta un incentivo mayor para que el cliente los lleve en conjunto." }); }
  pct = Math.max(0, Math.min(25, Math.floor(pct * 10) / 10));
  const price = r2(sumPrice * (1 - pct / 100));
  steps.push({ rule: "Resultado", how: `Descuento recomendado ${pct}%, precio del combo ${price}.`, why: "Tope de 25% para proteger la rentabilidad." });
  return { discount_percent: pct, normal_price: r2(sumPrice), combo_price: price, trace: { summary: `Combo recomendado con ${pct}% de descuento`, steps } as Trace };
}

// ---------- 5. DASHBOARD ----------
export async function dashboard() {
  const inv = (await q("SELECT COUNT(*)::int n, COALESCE(SUM(total),0) revenue, COALESCE(SUM(discount),0) discounts, COALESCE(SUM(profit),0) profit FROM invoices")).rows[0];
  const units = (await q("SELECT COALESCE(SUM(qty-returned_qty),0)::int n FROM invoice_items")).rows[0].n;
  const ret = (await q("SELECT COUNT(*)::int n, COALESCE(SUM(CASE WHEN approved THEN amount END),0) refunded, COUNT(*) FILTER (WHERE approved)::int ok FROM returns")).rows[0];
  const costBack = (await q("SELECT COALESCE(SUM(returned_qty*unit_cost),0) c FROM invoice_items")).rows[0].c;
  const byDay = (await q("SELECT to_char(created_at::date,'MM-DD') d, SUM(total) total, SUM(profit) profit, COUNT(*)::int n FROM invoices GROUP BY created_at::date ORDER BY created_at::date")).rows;
  const top = (await q("SELECT p.name, SUM(ii.qty-ii.returned_qty)::int units FROM invoice_items ii JOIN products p ON p.id=ii.product_id GROUP BY p.name ORDER BY units DESC LIMIT 6")).rows;
  const rules = (await q("SELECT * FROM rules WHERE active AND kind='expiry_discount'")).rows;
  const expiring = (await q("SELECT id,name,price,stock,expires_at FROM products WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_DATE + 30 ORDER BY expires_at")).rows.map((p: any) => {
    const dl = daysLeft(p.expires_at)!;
    const pct = Math.max(0, ...rules.filter((r: any) => dl <= r.params.max_days).map((r: any) => r.params.percent));
    return { ...p, days_left: dl, offer_percent: pct, offer_price: r2(p.price * (1 - pct / 100)) };
  });
  const combos = (await q("SELECT id,name,discount_percent,product_ids FROM combos WHERE active")).rows;
  return {
    units_sold: units, invoices: inv.n, transactions: inv.n + ret.n, discounts: inv.discounts,
    revenue: r2(inv.revenue - ret.refunded), profit: r2(inv.profit - ret.refunded + costBack),
    returns_total: ret.n, returns_approved: ret.ok, by_day: byDay, top, expiring, combos,
  };
}

// ---------- 6. "Pregúntale al sistema" ----------
export async function ask(question: string) {
  const mode = /por\s?qu[eé]|porque|why/i.test(question) ? "why" : "how";
  const m = question.match(/(factura|devoluci[oó]n|combo|producto)\s*#?\s*(\d+)/i);
  if (!m) return "Pregúntame por una decisión concreta, por ejemplo: «¿por qué factura 3?», «¿cómo devolución 2?», «¿por qué combo 1?» o «¿por qué producto 5?».";
  const kind = m[1].toLowerCase().replace("ó", "o"), id = Number(m[2]);
  const table = ({ factura: "invoices", devolucion: "returns", combo: "combos", producto: "products" } as any)[kind];
  const row = (await q(`SELECT trace FROM ${table} WHERE id=$1`, [id])).rows[0];
  if (!row?.trace) return `No tengo registro de ${kind} #${id}.`;
  const t = row.trace as Trace;
  return `${t.summary}\n\n` + t.steps.map((s, i) => `${i + 1}. [${s.rule}] ${mode === "why" ? s.why : s.how}`).join("\n");
}
