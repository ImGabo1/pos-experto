import { q } from "./db";
import { processSale, processReturn } from "./engine";

const T = (summary: string, how: string, why: string) => ({ summary, steps: [{ rule: "Dato precargado", how, why }] });

export async function seed() {
  if ((await q("SELECT COUNT(*)::int n FROM products")).rows[0].n > 0) return;

  const P: [string, string, number, number, number, number | null][] = [
    ["Leche entera 1L", "Lácteos", 1.2, 1.8, 60, 5], ["Yogur natural", "Lácteos", 0.8, 1.3, 40, 12],
    ["Queso blanco 500g", "Lácteos", 3, 4.5, 25, 20], ["Pan de sándwich", "Panadería", 1, 1.7, 50, 4],
    ["Harina de maíz 1kg", "Despensa", 0.9, 1.4, 120, 180], ["Arroz 1kg", "Despensa", 0.95, 1.5, 100, 240],
    ["Aceite 1L", "Despensa", 2.5, 3.6, 70, 300], ["Café molido 250g", "Despensa", 2.2, 3.5, 45, 150],
    ["Jabón de baño", "Higiene", 0.5, 0.9, 90, null], ["Shampoo 400ml", "Higiene", 2, 3.2, 35, null],
    ["Refresco 2L", "Bebidas", 1.1, 1.9, 80, 90], ["Agua 5L", "Bebidas", 0.8, 1.4, 60, null],
  ];
  for (const [n, c, co, pr, st, d] of P)
    await q("INSERT INTO products(name,category,cost,price,stock,expires_at,trace) VALUES($1,$2,$3,$4,$5,CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END,$7)",
      [n, c, co, pr, st, d, T(`Producto precargado ${n}`, "Registrado en la carga inicial.", "Datos de ejemplo para demostrar el sistema.")]);

  const R: [string, any, string][] = [
    ["qty_discount", { min_qty: 3, percent: 5 }, "3 o más unidades de un producto → 5%"],
    ["qty_discount", { min_qty: 10, percent: 10 }, "10 o más unidades de un producto → 10%"],
    ["expiry_discount", { max_days: 15, percent: 10 }, "Vence en 15 días o menos → 10%"],
    ["expiry_discount", { max_days: 7, percent: 20 }, "Vence en 7 días o menos → 20%"],
    ["return_window", { days: 15 }, "Plazo máximo de devolución: 15 días"],
    ["non_returnable_category", { categories: ["Higiene"] }, "Productos de higiene no admiten devolución"],
  ];
  for (const [k, p, d] of R) await q("INSERT INTO rules(kind,params,description) VALUES($1,$2,$3)", [k, p, d]);

  const C: [string, number[], number][] = [["Combo Desayuno", [1, 4, 8], 10], ["Combo Despensa básica", [5, 6, 7], 8], ["Combo Aseo personal", [9, 10], 12]];
  for (const [n, ids, pct] of C)
    await q("INSERT INTO combos(name,discount_percent,product_ids,trace) VALUES($1,$2,$3,$4)", [n, pct, ids, T(`Combo precargado ${n}`, `Descuento fijado en ${pct}%.`, "Combo de ejemplo de la carga inicial.")]);

  // Facturas y devoluciones precargadas (pasan por el mismo motor)
  const carts = [[{ product_id: 1, qty: 4 }, { product_id: 4, qty: 2 }], [{ product_id: 5, qty: 12 }, { product_id: 6, qty: 3 }, { product_id: 7, qty: 1 }],
    [{ product_id: 9, qty: 3 }, { product_id: 10, qty: 1 }, { product_id: 11, qty: 2 }], [{ product_id: 1, qty: 2 }, { product_id: 4, qty: 1 }, { product_id: 8, qty: 1 }]];
  const ids: number[] = [];
  for (const c of carts) ids.push((await processSale(c)).id);
  const ages = [30, 6, 2, 0];
  for (let i = 0; i < ids.length; i++) await q("UPDATE invoices SET created_at = now() - ($1 || ' days')::interval WHERE id=$2", [ages[i], ids[i]]);
  const item = async (inv: number, prod: number) => (await q("SELECT id FROM invoice_items WHERE invoice_id=$1 AND product_id=$2", [inv, prod])).rows[0].id;
  await processReturn(await item(ids[1], 6), 1); // aprobada
  await processReturn(await item(ids[0], 1), 1); // rechazada: fuera de plazo
  await processReturn(await item(ids[2], 9), 1); // rechazada: categoría
}
