const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Error de servidor");
  return j;
}
export type Step = { rule: string; how: string; why: string };
export type Trace = { summary: string; steps: Step[] };
export const money = (n: number) => `$${Number(n).toFixed(2)}`;
