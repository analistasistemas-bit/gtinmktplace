// Fake do PostgREST para a inbox do bot (ADR-0190 D-8): tabelas em memória (eq/order/range/
// maybeSingle/upsert ignoreDuplicates/update) + as RPCs de lease da migration telegram_bot_inbox
// com a mesma semântica de CAS. `falhar` injeta erro por operação ('upsert', 'rpc:<nome>', 'from:<tabela>').
import { vi } from 'vitest';

type Linha = Record<string, any>;

export function fakeInboxAdmin(tabelas: Record<string, Linha[]> = {}, agoraPadrao = '2026-10-25T12:00:00.000Z') {
  let seq = 0;
  const falhar = new Set<string>();
  const t = (nome: string) => (tabelas[nome] ??= []);
  const achar = (b: number, u: number) => t('telegram_updates').find((l) => l.bot_id === b && l.update_id === u);
  const erro = (k: string) => (falhar.has(k) ? { message: `falha simulada ${k}` } : null);

  const rpcs: Record<string, (a: any) => any> = {
    telegram_update_reivindicar: ({ p_bot, p_update, p_agora }) => {
      const l = achar(p_bot, p_update);
      const agora = Date.parse(p_agora);
      if (!l || !(l.status === 'recebido' || (l.status === 'processando' && Date.parse(l.lease_ate) < agora))) return [];
      Object.assign(l, { status: 'processando', lease_id: `lease-${++seq}`, lease_ate: new Date(agora + 60_000).toISOString(), tentativas: l.tentativas + 1 });
      return [{ ...l }];
    },
    telegram_update_confirmar_posse: ({ p_bot, p_update, p_lease, p_agora }) => {
      const l = achar(p_bot, p_update);
      const agora = Date.parse(p_agora);
      if (!l || l.lease_id !== p_lease || l.status !== 'processando' || Date.parse(l.lease_ate) < agora) return false;
      l.lease_ate = new Date(agora + 60_000).toISOString();
      return true;
    },
    telegram_update_concluir: ({ p_bot, p_update, p_lease, p_status, p_erro }) => {
      const l = achar(p_bot, p_update);
      if (!l || l.lease_id !== p_lease || l.status !== 'processando') return false;
      Object.assign(l, { status: p_status, erro: p_erro, lease_id: null, lease_ate: null });
      return true;
    },
    telegram_update_devolver: ({ p_bot, p_update, p_lease, p_erro }) => {
      const l = achar(p_bot, p_update);
      if (!l || l.lease_id !== p_lease || l.status !== 'processando') return false;
      Object.assign(l, { status: l.tentativas >= 5 ? 'falhou' : 'recebido', erro: p_erro, lease_id: null, lease_ate: null });
      return true;
    },
    telegram_updates_parados: ({ p_agora, p_depois_bot, p_depois_update, p_limite }) => {
      const agora = Date.parse(p_agora);
      return t('telegram_updates')
        .filter((l) => (l.status === 'recebido' && Date.parse(l.publicado_em ?? l.recebido_em) < agora - 90_000)
          || (l.status === 'processando' && Date.parse(l.lease_ate) < agora))
        .filter((l) => p_depois_bot == null || l.bot_id > p_depois_bot || (l.bot_id === p_depois_bot && l.update_id > p_depois_update))
        .sort((a, b) => a.bot_id - b.bot_id || a.update_id - b.update_id)
        .slice(0, p_limite)
        .map((l) => ({ bot_id: l.bot_id, update_id: l.update_id, tentativas: l.tentativas }));
    },
  };

  const admin: any = {
    tabelas, falhar,
    get linhas() { return t('telegram_updates'); },
    rpc: vi.fn(async (fn: string, args: any) => {
      const e = erro(`rpc:${fn}`);
      return e ? { data: null, error: e } : { data: rpcs[fn](args), error: null };
    }),
    from: (tabela: string) => {
      const st: { op: string; row?: Linha; patch?: Linha; range?: [number, number]; f: Array<(r: Linha) => boolean> } = { op: 'select', f: [] };
      const run = () => {
        const e = erro(`from:${tabela}`) ?? (st.op === 'upsert' ? erro('upsert') : null);
        if (e) return { data: null, error: e };
        if (st.op === 'upsert') {
          const r = st.row!;
          if (achar(r.bot_id, r.update_id)) return { data: [], error: null };
          const nova = { status: 'recebido', tentativas: 0, publicado_em: null, recebido_em: agoraPadrao, ...r };
          t(tabela).push(nova);
          return { data: [{ update_id: nova.update_id }], error: null };
        }
        const alvo = t(tabela).filter((l) => st.f.every((f) => f(l)));
        if (st.op === 'update') alvo.forEach((l) => Object.assign(l, st.patch));
        const out = alvo.map((l) => ({ ...l }));
        return { data: st.range ? out.slice(st.range[0], st.range[1] + 1) : out, error: null };
      };
      const c: any = {
        select: () => c,
        eq: (k: string, v: unknown) => { st.f.push((r) => r[k] === v); return c; },
        order: () => c,
        range: (a: number, b: number) => { st.range = [a, b]; return c; },
        upsert: (row: Linha) => { st.op = 'upsert'; st.row = row; return c; },
        update: (patch: Linha) => { st.op = 'update'; st.patch = patch; return c; },
        maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return c;
    },
  };
  return admin;
}
