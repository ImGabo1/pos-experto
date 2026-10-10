import { useEffect, useState, ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api, money, Trace } from "./api";

const TABS = ["Dashboard", "Venta (POS)", "Productos", "Combos", "Devoluciones", "Reglas", "Preguntar al sistema"] as const;
type Tab = (typeof TABS)[number];

function useLoad<T>(path: string, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const reload = () => api<T>(path).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { reload(); }, deps); // eslint-disable-line
  return { data, err, reload };
}

function Explain({ trace }: { trace?: Trace | null }) {
  const [mode, setMode] = useState<"how" | "why" | null>(null);
  if (!trace) return null;
  return (
    <div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn alt sm" onClick={() => setMode(mode === "how" ? null : "how")}>¿Cómo lo hizo?</button>
        <button className="btn alt sm" onClick={() => setMode(mode === "why" ? null : "why")}>¿Por qué?</button>
      </div>
      {mode && (
        <div className="trace">
          <b>{trace.summary}</b>
          {trace.steps.map((s, i) => (
            <div key={i}><small>{s.rule}</small>{mode === "how" ? s.how : s.why}</div>
          ))}
        </div>
      )}
    </div>
  );
}

const Err = ({ msg }: { msg: string }) => (msg ? <div className="err">{msg}</div> : null);
const Card = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className="card">{title && <h3>{title}</h3>}{children}</div>
);

/* ---------------- Dashboard ---------------- */
function Dashboard() {
  const { data: d, err } = useLoad<any>("/dashboard");
  if (err) return <Err msg={err} />;
  if (!d) return <p>Cargando…</p>;
  const k = (label: string, v: string | number) => <div className="card kpi"><b>{v}</b><span>{label}</span></div>;
  return (
    <>
      <div className="grid">
        {k("Productos vendidos", d.units_sold)}{k("Facturas", d.invoices)}{k("Transacciones (ventas + devoluciones)", d.transactions)}
        {k("Descuentos automáticos", money(d.discounts))}{k("Ingresos netos", money(d.revenue))}{k("Ganancias", money(d.profit))}
        {k("Devoluciones (aprobadas/total)", `${d.returns_approved}/${d.returns_total}`)}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <Card title="Ventas y ganancia por día">
          <ResponsiveContainer width="100%" height={240}><BarChart data={d.by_day}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="d" /><YAxis /><Tooltip /><Legend />
            <Bar dataKey="total" name="Ventas" fill="#3b5bdb" /><Bar dataKey="profit" name="Ganancia" fill="#2f9e44" />
          </BarChart></ResponsiveContainer>
        </Card>
        <Card title="Productos más vendidos">
          <ResponsiveContainer width="100%" height={240}><BarChart data={d.top} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" width={120} /><Tooltip />
            <Bar dataKey="units" name="Unidades" fill="#f08c00" />
          </BarChart></ResponsiveContainer>
        </Card>
      </div>
      <Card title="Ofertas automáticas por fecha de vencimiento">
        <table><thead><tr><th>Producto</th><th>Vence</th><th>Días</th><th>Stock</th><th>Precio</th><th>Oferta</th></tr></thead><tbody>
          {d.expiring.map((p: any) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.expires_at}</td><td>{p.days_left}</td><td>{p.stock}</td><td>{money(p.price)}</td>
              <td>{p.offer_percent ? <span className="ok">{p.offer_percent}% → {money(p.offer_price)}</span> : "—"}</td></tr>
          ))}
        </tbody></table>
      </Card>
      <Card title="Combos con descuento automático">
        <ul>{d.combos.map((c: any) => <li key={c.id}>{c.name}: {c.discount_percent}% de descuento</li>)}</ul>
      </Card>
    </>
  );
}

/* ---------------- Venta POS ---------------- */
function POS() {
  const { data: prods } = useLoad<any[]>("/products");
  const [cart, setCart] = useState<{ product_id: number; qty: number }[]>([]);
  const [sel, setSel] = useState(0); const [qty, setQty] = useState(1);
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState(""); const [done, setDone] = useState("");
  const name = (id: number) => prods?.find((p) => p.id === id)?.name;
  const add = () => { if (!sel) return; setCart([...cart.filter((c) => c.product_id !== sel), { product_id: sel, qty }]); setRes(null); setDone(""); };
  const calc = () => api("/sales/preview", { items: cart }).then((r) => { setRes(r); setErr(""); }).catch((e) => setErr(e.message));
  const pay = () => api("/sales", { items: cart }).then((r) => { setRes(r); setDone(`Factura #${r.id} registrada`); setCart([]); setErr(""); }).catch((e) => setErr(e.message));
  return (
    <>
      <Card title="Simular venta">
        <div className="row">
          <select value={sel} onChange={(e) => setSel(Number(e.target.value))}>
            <option value={0}>Elegir producto…</option>
            {prods?.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)} (stock {p.stock})</option>)}
          </select>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ width: 80 }} />
          <button className="btn" onClick={add}>Agregar</button>
        </div>
        <table><tbody>{cart.map((c) => (
          <tr key={c.product_id}><td>{name(c.product_id)}</td><td>x{c.qty}</td>
            <td><button className="btn alt sm" onClick={() => setCart(cart.filter((x) => x !== c))}>Quitar</button></td></tr>
        ))}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn alt" disabled={!cart.length} onClick={calc}>Aplicar descuentos automáticos</button>
          <button className="btn" disabled={!cart.length} onClick={pay}>Facturar</button>
        </div>
      </Card>
      <Err msg={err} />{done && <div className="card ok">{done}</div>}
      {res && (
        <Card title="Resultado">
          <table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Total</th></tr></thead><tbody>
            {res.lines.map((l: any) => <tr key={l.product_id}><td>{l.name}</td><td>{l.qty}</td><td>{money(l.unit_price)}</td>
              <td>{l.pct ? <span className="ok">{l.pct}% (−{money(l.discount)})</span> : "—"}</td><td>{money(l.total)}</td></tr>)}
          </tbody></table>
          <p><b>Subtotal</b> {money(res.subtotal)} · <b>Descuento</b> {money(res.discount)} · <b>Total</b> {money(res.total)}</p>
          <Explain trace={res.trace} />
        </Card>
      )}
    </>
  );
}

/* ---------------- Productos ---------------- */
function Products() {
  const { data: prods, reload } = useLoad<any[]>("/products");
  const [f, setF] = useState({ name: "", category: "", cost: "", stock: "10", expires_at: "" });
  const [sug, setSug] = useState<any>(null); const [price, setPrice] = useState(""); const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const suggest = () => api("/products/suggest", { name: f.name, category: f.category, cost: Number(f.cost) })
    .then((s) => { setSug(s); setPrice(String(s.price)); setErr(""); }).catch((e) => setErr(e.message));
  const save = () => api("/products", { ...f, cost: Number(f.cost), stock: Number(f.stock), price: Number(price) || undefined })
    .then(() => { setSug(null); setF({ name: "", category: "", cost: "", stock: "10", expires_at: "" }); reload(); }).catch((e) => setErr(e.message));
  return (
    <>
      <Card title="Registrar producto nuevo">
        <div className="row">
          <input placeholder="Nombre" value={f.name} onChange={(e) => set("name", e.target.value)} />
          <input placeholder="Categoría" list="cats" value={f.category} onChange={(e) => set("category", e.target.value)} />
          <datalist id="cats">{[...new Set(prods?.map((p) => p.category))].map((c) => <option key={c} value={c} />)}</datalist>
          <input placeholder="Costo" type="number" step="0.01" value={f.cost} onChange={(e) => set("cost", e.target.value)} style={{ width: 90 }} />
          <input placeholder="Stock" type="number" value={f.stock} onChange={(e) => set("stock", e.target.value)} style={{ width: 80 }} />
          <input type="date" value={f.expires_at} onChange={(e) => set("expires_at", e.target.value)} title="Vencimiento (opcional)" />
          <button className="btn alt" disabled={!f.name || !f.category || !f.cost} onClick={suggest}>Pedir recomendación</button>
        </div>
        <Err msg={err} />
        {sug && (<>
          <p>Precio recomendado <b>{money(sug.price)}</b> · descuento máximo recomendado <b>{sug.maxDiscount}%</b></p>
          <div className="row">Precio final: <input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 100 }} />
            <button className="btn" onClick={save}>Registrar</button></div>
          <Explain trace={sug.trace} />
        </>)}
      </Card>
      <Card title="Inventario">
        <table><thead><tr><th>#</th><th>Producto</th><th>Categoría</th><th>Costo</th><th>Precio</th><th>Stock</th><th>Vence</th><th></th></tr></thead><tbody>
          {prods?.map((p) => <tr key={p.id}><td>{p.id}</td><td>{p.name}</td><td>{p.category}</td><td>{money(p.cost)}</td><td>{money(p.price)}</td>
            <td>{p.stock}</td><td>{p.expires_at ?? "—"}</td><td><Explain trace={p.trace} /></td></tr>)}
        </tbody></table>
      </Card>
    </>
  );
}

/* ---------------- Combos ---------------- */
function Combos() {
  const { data: prods } = useLoad<any[]>("/products");
  const { data: combos, reload } = useLoad<any[]>("/combos");
  const [ids, setIds] = useState<number[]>([]); const [name, setName] = useState(""); const [sug, setSug] = useState<any>(null); const [err, setErr] = useState("");
  const toggle = (id: number) => { setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]); setSug(null); };
  const suggest = () => api("/combos/suggest", { product_ids: ids }).then((s) => { setSug(s); setErr(""); }).catch((e) => setErr(e.message));
  const save = () => api("/combos", { name, product_ids: ids, discount_percent: sug.discount_percent })
    .then(() => { setIds([]); setSug(null); setName(""); reload(); }).catch((e) => setErr(e.message));
  return (
    <>
      <Card title="Crear combo (el sistema recomienda el descuento)">
        <div className="row">{prods?.map((p) => (
          <label key={p.id}><input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}</label>
        ))}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="Nombre del combo" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn alt" disabled={ids.length < 2} onClick={suggest}>Pedir recomendación</button>
        </div>
        <Err msg={err} />
        {sug && (<>
          <p>Descuento recomendado <b>{sug.discount_percent}%</b> · precio normal {money(sug.normal_price)} → combo <b>{money(sug.combo_price)}</b></p>
          <button className="btn" disabled={!name} onClick={save}>Crear combo</button>
          <Explain trace={sug.trace} />
        </>)}
      </Card>
      <Card title="Combos activos">
        <table><tbody>{combos?.map((c) => (
          <tr key={c.id}><td>#{c.id} {c.name}</td><td>{c.discount_percent}%</td><td>{c.product_ids.map((i: number) => prods?.find((p) => p.id === i)?.name).join(", ")}</td>
            <td><Explain trace={c.trace} /></td></tr>
        ))}</tbody></table>
      </Card>
    </>
  );
}

/* ---------------- Devoluciones ---------------- */
function Returns() {
  const { data: invs, reload } = useLoad<any[]>("/invoices");
  const { data: rets, reload: reloadR } = useLoad<any[]>("/returns");
  const [res, setRes] = useState<any>(null); const [err, setErr] = useState("");
  const go = (id: number) => api("/returns", { invoice_item_id: id, qty: 1 })
    .then((r) => { setRes(r); setErr(""); reload(); reloadR(); }).catch((e) => setErr(e.message));
  return (
    <>
      <Err msg={err} />
      {res && <Card title={res.approved ? "Devolución aprobada" : "Devolución rechazada"}>
        <p className={res.approved ? "ok" : "bad"}>{res.approved ? `Reembolso ${money(res.amount)}` : "No procede"}</p><Explain trace={res.trace} /></Card>}
      <Card title="Facturas (botón devuelve 1 unidad del ítem)">
        {invs?.map((i) => (
          <div key={i.id} style={{ marginBottom: 12 }}>
            <b>Factura #{i.id}</b> <span className="mute">{new Date(i.created_at).toLocaleDateString()} · total {money(i.total)}</span>
            <table><tbody>{i.items.map((it: any) => (
              <tr key={it.id}><td>{it.name}</td><td>x{it.qty}</td><td>devueltos: {it.returned_qty}</td>
                <td><button className="btn alt sm" onClick={() => go(it.id)}>Devolver 1</button></td></tr>
            ))}</tbody></table>
          </div>
        ))}
      </Card>
      <Card title="Historial de devoluciones">
        <table><tbody>{rets?.map((r) => (
          <tr key={r.id}><td>#{r.id}</td><td>Factura #{r.invoice_id}</td><td className={r.approved ? "ok" : "bad"}>{r.approved ? "Aprobada" : "Rechazada"}</td>
            <td>{money(r.amount)}</td><td><Explain trace={r.trace} /></td></tr>
        ))}</tbody></table>
      </Card>
    </>
  );
}

/* ---------------- Reglas (base de conocimiento) ---------------- */
const TEMPLATES: Record<string, string> = {
  qty_discount: '{"min_qty": 5, "percent": 7}',
  expiry_discount: '{"max_days": 30, "percent": 5}',
  return_window: '{"days": 10}',
  non_returnable_category: '{"categories": ["Higiene"]}',
};
function Rules() {
  const { data: rules, reload } = useLoad<any[]>("/rules");
  const [kind, setKind] = useState("qty_discount"); const [params, setParams] = useState(TEMPLATES.qty_discount);
  const [desc, setDesc] = useState(""); const [err, setErr] = useState("");
  const add = () => { let p; try { p = JSON.parse(params); } catch { return setErr("Los parámetros no son JSON válido"); }
    api("/rules", { kind, params: p, description: desc }).then(() => { setDesc(""); setErr(""); reload(); }).catch((e) => setErr(e.message)); };
  return (
    <>
      <Card title="Agregar conocimiento (nueva regla)">
        <div className="row">
          <select value={kind} onChange={(e) => { setKind(e.target.value); setParams(TEMPLATES[e.target.value]); }}>
            {Object.keys(TEMPLATES).map((k) => <option key={k}>{k}</option>)}
          </select>
          <input value={params} onChange={(e) => setParams(e.target.value)} style={{ minWidth: 260 }} />
          <input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="btn" onClick={add}>Agregar</button>
        </div>
        <Err msg={err} />
      </Card>
      <Card title="Base de conocimiento">
        <table><tbody>{rules?.map((r) => (
          <tr key={r.id}><td>#{r.id}</td><td>{r.kind}</td><td>{r.description}</td><td><code>{JSON.stringify(r.params)}</code></td>
            <td><button className="btn alt sm" onClick={() => api(`/rules/${r.id}/toggle`, {}, "PATCH").then(reload)}>{r.active ? "Activa" : "Inactiva"}</button></td></tr>
        ))}</tbody></table>
      </Card>
    </>
  );
}

/* ---------------- Preguntar ---------------- */
function Ask() {
  const [q, setQ] = useState(""); const [log, setLog] = useState<{ q: string; a: string }[]>([]);
  const send = () => { if (!q.trim()) return; api("/ask", { question: q }).then((r) => setLog([{ q, a: r.answer }, ...log])); setQ(""); };
  return (
    <>
      <Card title="Pregúntale al sistema">
        <p className="mute">Ejemplos: «¿por qué factura 4?», «¿cómo devolución 2?», «¿por qué combo 1?», «¿por qué producto 5?»</p>
        <div className="row"><input style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <button className="btn" onClick={send}>Preguntar</button></div>
      </Card>
      {log.map((l, i) => <Card key={i}><b>{l.q}</b><pre>{l.a}</pre></Card>)}
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("Dashboard");
  const view = { "Dashboard": <Dashboard />, "Venta (POS)": <POS />, "Productos": <Products />, "Combos": <Combos />,
    "Devoluciones": <Returns />, "Reglas": <Rules />, "Preguntar al sistema": <Ask /> }[tab];
  return (
    <>
      <header>Sistema Experto POS de Ventas</header>
      <nav>{TABS.map((t) => <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</nav>
      <main key={tab}>{view}</main>
    </>
  );
}
