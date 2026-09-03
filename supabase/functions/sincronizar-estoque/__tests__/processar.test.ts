import { describe, it, expect, beforeEach, vi } from 'vitest';

// ml/token.ts importa _shared/supabase.ts, que faz `import { createClient } from 'jsr:...'`
// (valor real, não elidido pelo bundler). Sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { processarSincronizacao, type DepsSincronizacao } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ChannelConnector } from '../../_shared/canais/contrato';

interface MovimentoFake {
  id: string; org_id: string; codigo_pai: string; codigo: string;
  estoque_anterior: number; estoque_resultante: number; alertado_em: string | null;
}

interface DB {
  familia: { id: string; nome_pai?: string | null; ml_permalink?: string | null } | null;
  variacoes: Array<{ codigo: string; estoque: number; nome?: string | null; cor?: string | null }>;
  anuncios: Array<Record<string, unknown>>;
  itensUP: Array<Record<string, unknown>>;
  /** ADR-0134: transições >0 → 0 candidatas a alerta. */
  movimentos?: MovimentoFake[];
}

/** Fake mínimo do SupabaseClient: só os padrões de query que processarSincronizacao usa.
 * `estoque_movimentos` guarda estado de verdade (filtros + update) porque a dedup do alerta
 * (ADR-0134) É o update condicional — testá-la com um stub que ignora filtro não provaria nada. */
function fakeAdmin(db: DB) {
  function chain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const filtros: Array<(r: any) => boolean> = [];
    let valoresUpdate: Record<string, unknown> | null = null;
    // `.not()` só existe na query de `listarKitsVivos` (kit.ts) — nenhum teste aqui define
    // família de kit, então essa busca sempre devolve lista vazia (nenhum kit vinculado).
    let buscandoKits = false;

    function movimentosFiltrados(): MovimentoFake[] {
      return (db.movimentos ?? []).filter((r) => filtros.every((f) => f(r)));
    }
    function ler(): { data: unknown; error: null } {
      if (tabela === 'familias' && buscandoKits) return { data: [], error: null };
      if (tabela === 'familias') return { data: db.familia, error: null };
      if (tabela === 'variacoes') return { data: db.variacoes, error: null };
      if (tabela === 'anuncios_externos') return { data: db.anuncios, error: null };
      if (tabela === 'anuncios_externos_itens') return { data: db.itensUP, error: null };
      if (tabela === 'estoque_movimentos') {
        const alvo = movimentosFiltrados();
        if (valoresUpdate) for (const r of alvo) Object.assign(r, valoresUpdate);
        return { data: alvo.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: null };
    }
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      update: (v: Record<string, unknown>) => { valoresUpdate = v; return api; },
      // deno-lint-ignore no-explicit-any
      eq: (c: string, v: unknown) => { filtros.push((r: any) => r[c] === v); return api; },
      // deno-lint-ignore no-explicit-any
      gt: (c: string, v: number) => { filtros.push((r: any) => r[c] > v); return api; },
      // deno-lint-ignore no-explicit-any
      is: (c: string, v: unknown) => { filtros.push((r: any) => (r[c] ?? null) === v); return api; },
      // deno-lint-ignore no-explicit-any
      in: (c: string, vs: unknown[]) => { filtros.push((r: any) => vs.includes(r[c])); return api; },
      not: () => { buscandoKits = true; return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ler(),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve(ler()),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (t: string) => chain(t) } as any;
}

/** Um conector que não é o ML — prova que o push é genuinamente cross-canal. */
const conectorFake = fakeConnector as unknown as ChannelConnector;

function deps(db: DB, over: Partial<DepsSincronizacao> = {}): DepsSincronizacao {
  return {
    admin: fakeAdmin(db),
    // Stub: devolve conexão para qualquer canal. O resolverConexao REAL devolveria null
    // para 'fake' (não existe linha em marketplace_connections) e o conector nunca
    // seria alcançado — é exatamente por isso que a dependência é injetável.
    resolverConexao: (async () => ({ id: 'conn-1' })) as unknown as DepsSincronizacao['resolverConexao'],
    getConnector: (() => conectorFake) as unknown as DepsSincronizacao['getConnector'],
    // Idem: getValidAccessTokenConexao é específico do ML.
    fabricarToken: () => () => Promise.resolve('token-fake'),
    ...over,
  };
}

function chamadasDeEstoque() {
  return fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarEstoque')
    .map((c) => c.args as { itemExternoId: string; estoques: Array<{ sku: string; estoque: number }> });
}

const JOB = { org_id: 'org-1', codigo_pai: 'P001', canal_origem: null as string | null };

describe('processarSincronizacao', () => {
  beforeEach(() => fakeConnector.reset());

  it('produto sem família: não empurra nada', async () => {
    const r = await processarSincronizacao(
      deps({ familia: null, variacoes: [], anuncios: [], itensUP: [] }), JOB,
    );
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque()).toHaveLength(0);
  });

  it('empurra os valores ABSOLUTOS atuais para o anúncio', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }, { codigo: 'A2', estoque: 0 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {}, A2: {} } }],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db), JOB);
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque()).toEqual([
      { itemExternoId: 'FK1', estoques: [{ sku: 'A1', estoque: 5 }, { sku: 'A2', estoque: 0 }] },
    ]);
  });

  it('venda: o canal de ORIGEM não recebe push, os demais recebem', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 3 }],
      anuncios: [
        { id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db), { ...JOB, canal_origem: 'mercado_livre' });
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque().map((c) => c.itemExternoId)).toEqual(['FK1']);
  });

  it('entrada (canal_origem null): TODOS os canais recebem push', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 3 }],
      anuncios: [
        { id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK2', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
    };
    await processarSincronizacao(deps(db), { ...JOB, canal_origem: null });
    expect(chamadasDeEstoque().map((c) => c.itemExternoId)).toEqual(['FK1', 'FK2']);
  });

  // Regressão do bloqueador achado na revisão: a linha-mãe de uma família user
  // products tem item_externo_id NULL, e os ids vivem nos filhos.
  it('user products: pai com item_externo_id NULL → push em cada item filho', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }, { codigo: 'A3', estoque: 7 }],
      anuncios: [{ id: 'p0', canal: 'fake', item_externo_id: null, variacoes_externas: { A1: {}, A3: {} } }],
      itensUP: [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'FK-A1', retirado: false, status: 'ativo' },
        { anuncio_externo_id: 'p0', sku: 'A3', item_externo_id: 'FK-A3', retirado: false, status: 'ativo' },
      ],
    };
    await processarSincronizacao(deps(db), JOB);
    expect(chamadasDeEstoque()).toEqual([
      { itemExternoId: 'FK-A1', estoques: [{ sku: 'A1', estoque: 5 }] },
      { itemExternoId: 'FK-A3', estoques: [{ sku: 'A3', estoque: 7 }] },
    ]);
  });

  it('item UP em remoção não recebe push', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'p0', canal: 'fake', item_externo_id: null, variacoes_externas: { A1: {} } }],
      itensUP: [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'FK-A1', retirado: false, status: 'remocao_pendente' },
      ],
    };
    await processarSincronizacao(deps(db), JOB);
    expect(chamadasDeEstoque()).toHaveLength(0);
  });

  it('erro retentável no canal → 500 (QStash re-tenta; push absoluto é idempotente)', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
      itensUP: [],
    };
    fakeConnector.falharProximo('RATE_LIMIT', true);
    const r = await processarSincronizacao(deps(db), JOB);
    expect(r.status).toBe(500);
  });

  it('erro definitivo no canal → 200 (não adianta re-tentar)', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
      itensUP: [],
    };
    fakeConnector.falharProximo('ESTOQUE', false);
    const r = await processarSincronizacao(deps(db), JOB);
    expect(r.status).toBe(200);
  });

  it('exceção inesperada num alvo é tratada como retentável e não aborta os demais', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [
        { id: 'x', canal: 'explode', item_externo_id: 'E1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db, {
      getConnector: ((canal: string) => {
        if (canal === 'explode') throw new Error('conector quebrado');
        return conectorFake;
      }) as unknown as DepsSincronizacao['getConnector'],
    }), JOB);
    expect(r.status).toBe(500);                       // o alvo que explodiu vira retentável
    expect(chamadasDeEstoque()).toHaveLength(1);      // o outro canal foi empurrado assim mesmo
  });

  it('canal sem fábrica de token é pulado, não quebra o worker', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db, { fabricarToken: () => null }), JOB);
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque()).toHaveLength(0);
  });
});

/**
 * ADR-0111 — repor estoque reativa o anúncio pausado. O ML só desfaz sozinho a pausa que ele
 * mesmo aplicou por falta de estoque; pausa do vendedor fica de pé mesmo com o saldo já no canal
 * (produção 2026-08-11: MLB5040504553 com 70 unidades e ainda `paused`).
 */
describe('processarSincronizacao — reativação ao repor estoque (ADR-0111)', () => {
  beforeEach(() => fakeConnector.reset());

  const chamadasDeStatus = () =>
    fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarStatus')
      .map((c) => c.args as { itemExternoId: string; status: string });

  const umAnuncio = (estoque: number): DB => ({
    familia: { id: 'f1' },
    variacoes: [{ codigo: 'A1', estoque }],
    anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
    itensUP: [],
  });

  it('anúncio pausado + saldo > 0 → reativa', async () => {
    fakeConnector.statusVivo = 'pausado';
    const r = await processarSincronizacao(deps(umAnuncio(7)), { ...JOB, reativar: true });
    expect(r.status).toBe(200);
    expect(chamadasDeStatus()).toEqual([{ itemExternoId: 'FK1', status: 'ativo' }]);
  });

  // Idempotência: o QStash reentrega o job e a reconciliação repete o push.
  it('anúncio já ativo → nenhum PUT de status', async () => {
    fakeConnector.statusVivo = 'ativo';
    await processarSincronizacao(deps(umAnuncio(7)), { ...JOB, reativar: true });
    expect(chamadasDeStatus()).toEqual([]);
  });

  // A reconciliação diária re-empurra saldo de produto com movimento recente. Sem esta guarda,
  // um anúncio pausado de propósito voltaria ao ar sem ninguém ter reposto nada.
  it('push sem a flag (reconciliação) → não reativa, nem lê status', async () => {
    fakeConnector.statusVivo = 'pausado';
    await processarSincronizacao(deps(umAnuncio(7)), JOB);
    expect(chamadasDeStatus()).toEqual([]);
    expect(fakeConnector.chamadas.some((c) => c.metodo === 'lerStatus')).toBe(false);
  });

  it('saldo zero no alvo → não reativa', async () => {
    fakeConnector.statusVivo = 'pausado';
    await processarSincronizacao(deps(umAnuncio(0)), { ...JOB, reativar: true });
    expect(chamadasDeStatus()).toEqual([]);
  });

  // Forçar `active` num anúncio moderado é a escrita que cancelou um anúncio em 2026-08-06.
  it.each(['moderado', 'encerrado', 'inativo', 'indisponivel'] as const)(
    'anúncio %s → intocado', async (status) => {
      fakeConnector.statusVivo = status;
      await processarSincronizacao(deps(umAnuncio(7)), { ...JOB, reativar: true });
      expect(chamadasDeStatus()).toEqual([]);
    },
  );

  it('push de estoque falhou → não reativa (canal ficaria publicado e defasado)', async () => {
    fakeConnector.statusVivo = 'pausado';
    fakeConnector.falharProximo('ESTOQUE', true);
    const r = await processarSincronizacao(deps(umAnuncio(7)), { ...JOB, reativar: true });
    expect(r.status).toBe(500);
    expect(chamadasDeStatus()).toEqual([]);
  });

  it('user products: reativa cada item filho que tem saldo', async () => {
    fakeConnector.statusVivo = 'pausado';
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }, { codigo: 'A3', estoque: 0 }],
      anuncios: [{ id: 'p0', canal: 'fake', item_externo_id: null, variacoes_externas: { A1: {}, A3: {} } }],
      itensUP: [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'FK-A1', retirado: false, status: 'ativo' },
        { anuncio_externo_id: 'p0', sku: 'A3', item_externo_id: 'FK-A3', retirado: false, status: 'ativo' },
      ],
    };
    await processarSincronizacao(deps(db), { ...JOB, reativar: true });
    expect(chamadasDeStatus()).toEqual([{ itemExternoId: 'FK-A1', status: 'ativo' }]);
  });
});

// ─── ADR-0134: alerta de estoque zerado e de volta ao ar ──────────────────────
describe('alerta de estoque (ADR-0134)', () => {
  beforeEach(() => fakeConnector.reset());

  const enviados: Array<{ categoria: string; texto: string }> = [];
  const notificar = (async (_admin: unknown, _org: string, categoria: string, texto: string) => {
    enviados.push({ categoria, texto });
    return 1;
  }) as unknown as NonNullable<DepsSincronizacao['notificar']>;

  beforeEach(() => { enviados.length = 0; });

  const mov = (over: Partial<MovimentoFake> = {}): MovimentoFake => ({
    id: 'm1', org_id: 'org-1', codigo_pai: 'P001', codigo: 'A1',
    estoque_anterior: 2, estoque_resultante: 0, alertado_em: null, ...over,
  });

  const produto = (variacoes: DB['variacoes'], movimentos: MovimentoFake[], comAnuncio = true): DB => ({
    familia: { id: 'f1', nome_pai: 'Sabonete Nivea 200ml', ml_permalink: 'https://ml/MLB1' },
    variacoes,
    anuncios: comAnuncio
      ? [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {}, A2: {} } }]
      : [],
    itensUP: [],
    movimentos,
  });

  it('produto inteiro zerado avisa que o anúncio foi pausado', async () => {
    const db = produto([{ codigo: 'A1', estoque: 0 }], [mov()]);
    await processarSincronizacao(deps(db, { notificar }), JOB);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].categoria).toBe('estoque');
    expect(enviados[0].texto).toContain('Sabonete Nivea 200ml');
    expect(enviados[0].texto).toContain('anúncio pausado no Mercado Livre');
  });

  it('só uma variação zerada não anuncia pausa — o anúncio segue vendendo as outras', async () => {
    const db = produto(
      [{ codigo: 'A1', estoque: 0, cor: 'Azul' }, { codigo: 'A2', estoque: 4 }],
      [mov()],
    );
    await processarSincronizacao(deps(db, { notificar }), JOB);
    expect(enviados[0].texto).toContain('segue no ar');
    expect(enviados[0].texto).toContain('Azul (A1)');
  });

  it('reentrega do QStash não duplica: o movimento já marcado não alerta de novo', async () => {
    const db = produto([{ codigo: 'A1', estoque: 0 }], [mov()]);
    const d = deps(db, { notificar });
    await processarSincronizacao(d, JOB);
    await processarSincronizacao(d, JOB);
    expect(enviados).toHaveLength(1);
    expect(db.movimentos![0].alertado_em).not.toBeNull();
  });

  it('baixa que não zerou (2 → 1) não alerta', async () => {
    const db = produto([{ codigo: 'A1', estoque: 1 }], [mov({ estoque_resultante: 1 })]);
    await processarSincronizacao(deps(db, { notificar }), JOB);
    expect(enviados).toEqual([]);
  });

  it('zerada de produto que já nasceu zerado (0 → 0) não alerta', async () => {
    const db = produto([{ codigo: 'A1', estoque: 0 }], [mov({ estoque_anterior: 0 })]);
    await processarSincronizacao(deps(db, { notificar }), JOB);
    expect(enviados).toEqual([]);
  });

  // O caminho REAL da venda: o job carrega o canal onde ela ocorreu e `resolverAlvosPush` exclui
  // esse canal (ele já se decrementou sozinho). Com um único canal publicado, `alvos` fica vazio —
  // e é exatamente aí que o anúncio acabou de ser pausado por falta de estoque.
  it('venda que zera o estoque no único canal publicado ainda alerta', async () => {
    const db = produto([{ codigo: 'A1', estoque: 0 }], [mov()]);
    await processarSincronizacao(deps(db, { notificar }), { ...JOB, canal_origem: 'fake' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('anúncio pausado no Mercado Livre');
  });

  it('reativou num canal e outro ficou retentável: o aviso de volta ao ar não se perde', async () => {
    fakeConnector.statusVivo = 'pausado';
    fakeConnector.falharProximo('ESTOQUE', true);
    const db: DB = {
      familia: { id: 'f1', nome_pai: 'Sabonete Nivea 200ml', ml_permalink: null },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [
        { id: 'x1', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
        { id: 'x2', canal: 'fake2', item_externo_id: 'FK2', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
      movimentos: [],
    };
    const r = await processarSincronizacao(deps(db, { notificar }), { ...JOB, reativar: true });
    expect(r.status).toBe(500);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('voltou ao ar');
  });

  it('user products: reativação de N itens filhos avisa a volta ao ar UMA vez', async () => {
    fakeConnector.statusVivo = 'pausado';
    const db: DB = {
      familia: { id: 'f1', nome_pai: 'Sabonete Nivea 200ml', ml_permalink: null },
      variacoes: [{ codigo: 'A1', estoque: 5 }, { codigo: 'A2', estoque: 3 }],
      anuncios: [{ id: 'p0', canal: 'fake', item_externo_id: null, variacoes_externas: { A1: {}, A2: {} } }],
      itensUP: [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'FK-A1', retirado: false, status: 'ativo' },
        { anuncio_externo_id: 'p0', sku: 'A2', item_externo_id: 'FK-A2', retirado: false, status: 'ativo' },
      ],
      movimentos: [],
    };
    await processarSincronizacao(deps(db, { notificar }), { ...JOB, reativar: true });
    expect(enviados).toHaveLength(1);
  });

  // Publicar um produto velho não pode despejar a história inteira de zeradas de uma vez.
  it('produto sem anúncio publicado: marca o movimento e não envia nada', async () => {
    const db = produto([{ codigo: 'A1', estoque: 0 }], [mov()], false);
    await processarSincronizacao(deps(db, { notificar }), JOB);
    expect(enviados).toEqual([]);
    expect(db.movimentos![0].alertado_em).not.toBeNull();
  });

  it('push retentável não alerta agora — o canal ainda não recebeu o zero', async () => {
    fakeConnector.falharProximo('ESTOQUE', true);
    const db = produto([{ codigo: 'A1', estoque: 0 }], [mov()]);
    const r = await processarSincronizacao(deps(db, { notificar }), JOB);
    expect(r.status).toBe(500);
    expect(enviados).toEqual([]);
    expect(db.movimentos![0].alertado_em).toBeNull();
  });

  it('reposição que reativa o anúncio avisa a volta ao ar', async () => {
    fakeConnector.statusVivo = 'pausado';
    const db = produto([{ codigo: 'A1', estoque: 5 }], []);
    await processarSincronizacao(deps(db, { notificar }), { ...JOB, reativar: true });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain('voltou ao ar');
  });

  it('anúncio que já estava ativo não avisa volta ao ar', async () => {
    fakeConnector.statusVivo = 'ativo';
    const db = produto([{ codigo: 'A1', estoque: 5 }], []);
    await processarSincronizacao(deps(db, { notificar }), { ...JOB, reativar: true });
    expect(enviados).toEqual([]);
  });
});
