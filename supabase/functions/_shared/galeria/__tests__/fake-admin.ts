// Banco em memória para os testes da galeria (sem rede). Cobre só o que fatos/referências/galeria-fatos usam:
// filtros eq/neq/in/is/not-is, order, limit, select/insert/update/upsert, o bucket `imagens` e `rpc`
// (gravada em `rpcs`; resposta por `respostasRpc[nome]`, senão `{ data: null }`).
type Linha = Record<string, unknown>;
type Pred = (l: Linha) => boolean;

export interface Escrita { tabela: string; op: string; payload: unknown; afetadas: number }

export function fakeAdmin(db: Record<string, Linha[]>, arquivos: Map<string, Uint8Array> = new Map()) {
  const escritas: Escrita[] = [];
  const uploads: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const respostasRpc: Record<string, (args: Record<string, unknown>) => unknown> = {};
  let seq = 0;

  function from(tabela: string) {
    db[tabela] ??= [];
    const preds: Pred[] = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: Linha | Linha[] = {};
    let opcoes: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let ordem: { c: string; asc: boolean } | null = null;
    let lim = Infinity;

    const executar = (): { data: Linha[] | null; error: { message: string; code?: string } | null } => {
      const linhas = db[tabela];
      if (op === 'select') {
        let r = linhas.filter((l) => preds.every((p) => p(l)));
        if (ordem) {
          const { c, asc } = ordem;
          r = [...r].sort((a, b) => (String(a[c] ?? '') < String(b[c] ?? '') ? -1 : String(a[c] ?? '') > String(b[c] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        }
        return { data: r.slice(0, lim).map((l) => ({ ...l })), error: null };
      }
      if (op === 'update') {
        const alvo = linhas.filter((l) => preds.every((p) => p(l)));
        alvo.forEach((l) => Object.assign(l, payload));
        escritas.push({ tabela, op, payload, afetadas: alvo.length });
        return { data: alvo.map((l) => ({ ...l })), error: null };
      }
      const novas = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ ...p }));
      const chave = (opcoes.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      const gravadas: Linha[] = [];
      for (const n of novas) {
        const existente = chave.length > 0 ? linhas.find((l) => chave.every((c) => l[c] === n[c])) : undefined;
        if (existente) {
          if (op === 'insert') return { data: null, error: { message: 'duplicate key', code: '23505' } };
          if (!opcoes.ignoreDuplicates) { Object.assign(existente, n); gravadas.push(existente); }
          continue;
        }
        const l = { id: `id-${tabela}-${++seq}`, criado_em: new Date(Date.now() + seq).toISOString(), ...n };
        linhas.push(l);
        gravadas.push(l);
      }
      escritas.push({ tabela, op, payload, afetadas: gravadas.length });
      return { data: gravadas.map((l) => ({ ...l })), error: null };
    };

    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { preds.push((l) => l[c] === v); return q; },
      neq: (c: string, v: unknown) => { preds.push((l) => l[c] !== v); return q; },
      in: (c: string, vs: unknown[]) => { preds.push((l) => vs.includes(l[c])); return q; },
      is: (c: string, v: unknown) => { preds.push((l) => (l[c] ?? null) === v); return q; },
      not: (c: string, o: string, v: unknown) => {
        if (o !== 'is') throw new Error(`not.${o} não suportado`);
        preds.push((l) => (l[c] ?? null) !== v); return q;
      },
      order: (c: string, o?: { ascending?: boolean }) => { ordem = { c, asc: o?.ascending !== false }; return q; },
      limit: (n: number) => { lim = n; return q; },
      insert: (p: Linha | Linha[]) => { op = 'insert'; payload = p; return q; },
      update: (p: Linha) => { op = 'update'; payload = p; return q; },
      upsert: (p: Linha | Linha[], o: typeof opcoes = {}) => { op = 'upsert'; payload = p; opcoes = o; return q; },
      maybeSingle: async () => { const r = executar(); return { data: r.data?.[0] ?? null, error: r.error }; },
      single: async () => { const r = executar(); return r.data?.length ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { message: 'nenhuma linha' } }; },
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
        try { res(executar()); } catch (e) { rej?.(e); }
      },
    };
    return q;
  }

  const storage = {
    from: (_bucket: string) => ({
      download: async (p: string) => {
        const b = arquivos.get(p);
        return b ? { data: new Blob([b as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), error: null } : { data: null, error: { message: 'Object not found' } };
      },
      upload: async (p: string, corpo: Blob, o: { upsert?: boolean } = {}) => {
        uploads.push(p);
        if (arquivos.has(p) && !o.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
        arquivos.set(p, new Uint8Array(await corpo.arrayBuffer()));
        return { data: { path: p }, error: null };
      },
      createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` }, error: null }),
    }),
  };

  const rpc = async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    return { data: respostasRpc[nome]?.(args) ?? null, error: null };
  };

  return { admin: { from, storage, rpc }, escritas, uploads, arquivos, rpcs, respostasRpc };
}

export const JPEG = (marca: string) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(marca)]);
