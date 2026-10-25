// Fake mínimo do PostgREST em memória para os testes do resumo (ADR-0190): eq/in/gte/lt/is/
// contains/or, range, count+head, maybeSingle e o `!inner` de `ml_promocoes` (filtro
// `ml_promocoes.<col>` aplicado à promoção da mesma org) e o `familias!inner` de `variacoes`
// (join por familia_id, filtro `familias.<col>`). Registra cada consulta executada.
type Linha = Record<string, any>;
export interface Consulta { tabela: string; select: string; filtros: string[]; in?: unknown[]; range?: [number, number]; head?: boolean }

const instante = (v: unknown) => Date.parse(String(v));

function termo(s: string): (r: Linha) => boolean {
  if (s.startsWith('and(')) {
    const partes = dividir(s.slice(4, -1)).map(termo);
    return (r) => partes.every((p) => p(r));
  }
  const [col, op, ...resto] = s.split('.');
  const val = resto.join('.');
  if (op === 'is') return (r) => r[col] == null;
  if (op === 'gte') return (r) => r[col] != null && instante(r[col]) >= instante(val);
  if (op === 'lt') return (r) => r[col] != null && instante(r[col]) < instante(val);
  throw new Error(`fake: op ${op}`);
}

function dividir(s: string): string[] {
  const partes: string[] = [];
  let prof = 0, ini = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') prof++;
    else if (s[i] === ')') prof--;
    else if (s[i] === ',' && prof === 0) { partes.push(s.slice(ini, i)); ini = i + 1; }
  }
  partes.push(s.slice(ini));
  return partes;
}

export function fakeAdmin(tabelas: Record<string, Linha[]>) {
  const consultas: Consulta[] = [];
  const admin: any = {
    consultas,
    from: (tabela: string) => {
      const q: Consulta = { tabela, select: '', filtros: [] };
      const preds: Array<(r: Linha) => boolean> = [];
      // valor da coluna; `ml_promocoes.x` lê da promoção da mesma org (inner join)
      // `familias.x` lê da família da variação (embed `familias!inner`, join por familia_id)
      const col = (r: Linha, k: string) => {
        if (k.startsWith('familias.')) return (tabelas.familias ?? []).find((f) => f.id === r.familia_id)?.[k.slice('familias.'.length)];
        if (!k.startsWith('ml_promocoes.')) return r[k];
        const p = (tabelas.ml_promocoes ?? []).find((x) => x.org_id === r.org_id && x.promocao_id === r.promocao_id);
        return p?.[k.slice('ml_promocoes.'.length)];
      };
      const run = () => {
        consultas.push(q);
        let linhas = (tabelas[tabela] ?? []).filter((r) => preds.every((p) => p(r)));
        if (q.select.includes('ml_promocoes!inner')) {
          linhas = linhas.filter((r) => (tabelas.ml_promocoes ?? []).some((p) => p.org_id === r.org_id && p.promocao_id === r.promocao_id));
        }
        if (q.select.includes('familias!inner')) {
          linhas = linhas.flatMap((r) => {
            const f = (tabelas.familias ?? []).find((x) => x.id === r.familia_id);
            return f ? [{ ...r, familias: f }] : [];
          });
        }
        if (q.head) return { data: null, count: linhas.length, error: null };
        // sem `range`, o PostgREST corta em max_rows (1000)
        return { data: q.range ? linhas.slice(q.range[0], q.range[1] + 1) : linhas.slice(0, 1000), error: null };
      };
      const c: any = {
        select: (s: string, o?: { head?: boolean }) => { q.select = s; q.head = o?.head; return c; },
        eq: (k: string, v: unknown) => { q.filtros.push(`eq:${k}`); preds.push((r) => col(r, k) === v); return c; },
        in: (k: string, vs: unknown[]) => { q.filtros.push(`in:${k}`); q.in = vs; preds.push((r) => vs.includes(col(r, k))); return c; },
        gte: (k: string, v: unknown) => { q.filtros.push(`gte:${k}`); preds.push((r) => instante(r[k]) >= instante(v)); return c; },
        lt: (k: string, v: unknown) => { q.filtros.push(`lt:${k}`); preds.push((r) => instante(r[k]) < instante(v)); return c; },
        contains: (k: string, vs: unknown[]) => {
          q.filtros.push(`contains:${k}`);
          preds.push((r) => vs.every((v) => (r[k] ?? []).includes(v)));
          return c;
        },
        or: (s: string) => { q.filtros.push('or'); const fs = dividir(s).map(termo); preds.push((r) => fs.some((f) => f(r))); return c; },
        order: () => c, // ordenação não simulada: quem consome decide a canônica em memória
        range: (a: number, b: number) => { q.range = [a, b]; return c; },
        maybeSingle: async () => { const r = run(); return { data: (r.data ?? [])[0] ?? null, error: null }; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return c;
    },
  };
  return admin;
}
