import { it, expect, vi } from 'vitest';

// ml/token.ts importa _shared/supabase.ts, que faz `import { createClient } from 'jsr:...'`
// (valor real, não elidido pelo bundler). Sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { processarSincronizacao } from '../processar.ts';

/** Fake do supabase-js cobrindo só as tabelas que `processarSincronizacao` consulta. */
function fakeAdmin(dados: {
  familias: Array<Record<string, unknown>>;
  variacoes: Record<string, Array<Record<string, unknown>>>;
  anuncios: Array<Record<string, unknown>>;
}) {
  function q(tabela: string) {
    const filtros: Record<string, unknown> = {};
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => { filtros[col] = val; return api; },
      in: () => api,
      not: () => api,
      order: () => api,
      is: () => api,
      gt: () => api,
      limit: () => api,
      maybeSingle: () => {
        if (tabela === 'familias') {
          const f = dados.familias.find((x) =>
            (!filtros.codigo_pai || x.codigo_pai === filtros.codigo_pai));
          return Promise.resolve({ data: f ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (res: (v: unknown) => unknown) => {
        if (tabela === 'variacoes') {
          return Promise.resolve({ data: dados.variacoes[String(filtros.familia_id)] ?? [], error: null }).then(res);
        }
        if (tabela === 'anuncios_externos') {
          return Promise.resolve({
            data: dados.anuncios.filter((a) => a.codigo_pai === filtros.codigo_pai), error: null,
          }).then(res);
        }
        if (tabela === 'familias') {
          return Promise.resolve({
            data: dados.familias.filter((f) => f.kit_base_codigo_pai === filtros.kit_base_codigo_pai),
            error: null,
          }).then(res);
        }
        return Promise.resolve({ data: [], error: null }).then(res);
      },
      update: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (t: string) => q(t) } as any;
}

const DADOS = {
  familias: [
    { id: 'f-base', codigo_pai: '00000010', nome_pai: 'Produto', ml_permalink: null, criado_em: '2026-09-01', kit_base_codigo_pai: null, kit_multiplicador: null },
    { id: 'f-kit3', codigo_pai: '00000020', nome_pai: 'Kit 3', ml_permalink: null, criado_em: '2026-09-02', kit_base_codigo_pai: '00000010', kit_multiplicador: 3 },
  ],
  variacoes: {
    'f-base': [{ codigo: '00000011', estoque: 7, nome: 'Produto', cor: null }],
    'f-kit3': [{ codigo: '00000021', estoque: 0, nome: 'Kit 3', cor: null }],
  },
  anuncios: [
    { id: 'a-base', canal: 'mercado_livre', codigo_pai: '00000010', item_externo_id: 'MLB-BASE', variacoes_externas: null, status: 'publicado' },
    { id: 'a-kit3', canal: 'mercado_livre', codigo_pai: '00000020', item_externo_id: 'MLB-KIT3', variacoes_externas: null, status: 'publicado' },
  ],
};

function depsQueRegistram(chamadas: Array<{ item: string; estoques: unknown }>, dados = DADOS) {
  return {
    admin: fakeAdmin(dados),
    resolverConexao: () => Promise.resolve({ id: 'c1' }),
    getConnector: () => ({
      capabilities: { atualizarEstoque: true },
      atualizarEstoque: (_ctx: unknown, item: string, estoques: unknown) => {
        chamadas.push({ item, estoques });
        return Promise.resolve({ ok: true });
      },
      lerStatus: () => Promise.resolve({}),
      atualizarStatus: () => Promise.resolve({ ok: true }),
    }),
    fabricarToken: () => () => Promise.resolve('tok'),
    notificar: () => Promise.resolve(),
    // deno-lint-ignore no-explicit-any
  } as any;
}

it('push da base alcança o anúncio do kit com floor(base/N)', async () => {
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  await processarSincronizacao(depsQueRegistram(chamadas), {
    org_id: 'org-1', codigo_pai: '00000010', canal_origem: null,
  });
  expect(chamadas.length).toEqual(2);
  expect(chamadas.find((c) => c.item === 'MLB-BASE')?.estoques).toEqual([{ sku: '00000011', estoque: 7 }]);
  // 7 unidades da base = 2 kits de 3.
  expect(chamadas.find((c) => c.item === 'MLB-KIT3')?.estoques).toEqual([{ sku: '00000021', estoque: 2 }]);
});

it('com kit vinculado, venda no canal NÃO exclui nada — base e kit recebem push', async () => {
  // ADR-0151 D-7 (revisada): a exclusão por canal de origem deixa de valer quando há kit.
  // Push absoluto + recálculo do zero = mesmo resultado da exclusão fina, sem coluna nova.
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  await processarSincronizacao(depsQueRegistram(chamadas), {
    org_id: 'org-1', codigo_pai: '00000010', canal_origem: 'mercado_livre',
  });
  expect(chamadas.map((c) => c.item).sort()).toEqual(['MLB-BASE', 'MLB-KIT3']);
});

it('produto SEM kit mantém a exclusão por canal de hoje', async () => {
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  const semKit = {
    familias: [DADOS.familias[0]],
    variacoes: { 'f-base': DADOS.variacoes['f-base'] },
    anuncios: [DADOS.anuncios[0]],
  };
  await processarSincronizacao(depsQueRegistram(chamadas, semKit), {
    org_id: 'org-1', codigo_pai: '00000010', canal_origem: 'mercado_livre',
  });
  // O canal da venda já se decrementou sozinho: nada é empurrado de volta.
  expect(chamadas.length).toEqual(0);
});

it('job com o codigo_pai de um KIT é redirecionado para a base', async () => {
  // Nenhum caminho grava o codigo_pai de um kit no ledger, mas se acontecesse, empurrar
  // a coluna crua (`estoque` = 0) zeraria um anúncio vivo no ML.
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  await processarSincronizacao(depsQueRegistram(chamadas), {
    org_id: 'org-1', codigo_pai: '00000020', canal_origem: null,
  });
  expect(chamadas.map((c) => c.item).sort()).toEqual(['MLB-BASE', 'MLB-KIT3']);
  expect(chamadas.find((c) => c.item === 'MLB-KIT3')?.estoques).toEqual([{ sku: '00000021', estoque: 2 }]);
});

// ─── M-0b: o aviso de "voltou ao ar" usa o contexto de quem de fato reativou ────────
const DADOS_COM_PERMALINK = {
  familias: [
    { id: 'f-base', codigo_pai: '00000010', nome_pai: 'Produto', ml_permalink: 'https://ml/base', criado_em: '2026-09-01', kit_base_codigo_pai: null, kit_multiplicador: null },
    { id: 'f-kit3', codigo_pai: '00000020', nome_pai: 'Kit 3', ml_permalink: 'https://ml/kit3', criado_em: '2026-09-02', kit_base_codigo_pai: '00000010', kit_multiplicador: 3 },
  ],
  variacoes: DADOS.variacoes,
  anuncios: DADOS.anuncios,
};

/** Como `depsQueRegistram`, mas com `lerStatus`/`atualizarStatus` reais (por item) e `notificar`
 * injetável — necessário para exercitar a reativação (ADR-0111) por família. */
function depsComReativacao(
  chamadas: Array<{ item: string; estoques: unknown }>,
  pausados: Set<string>,
  notificar: (...args: unknown[]) => Promise<unknown>,
  dados = DADOS_COM_PERMALINK,
) {
  return {
    admin: fakeAdmin(dados),
    resolverConexao: () => Promise.resolve({ id: 'c1' }),
    getConnector: () => ({
      capabilities: { atualizarEstoque: true },
      atualizarEstoque: (_ctx: unknown, item: string, estoques: unknown) => {
        chamadas.push({ item, estoques });
        return Promise.resolve({ ok: true });
      },
      lerStatus: (_ctx: unknown, ids: string[]) => {
        const out: Record<string, { status: string }> = {};
        for (const id of ids) out[id] = { status: pausados.has(id) ? 'pausado' : 'ativo' };
        return Promise.resolve(out);
      },
      atualizarStatus: () => Promise.resolve({ ok: true }),
    }),
    fabricarToken: () => () => Promise.resolve('tok'),
    notificar,
    // deno-lint-ignore no-explicit-any
  } as any;
}

it('reativação vinda do KIT avisa com o contexto do KIT, não da base', async () => {
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  const enviados: Array<{ texto: string }> = [];
  const notificar = async (_admin: unknown, _org: string, _categoria: string, texto: string) => {
    enviados.push({ texto });
  };
  await processarSincronizacao(
    depsComReativacao(chamadas, new Set(['MLB-KIT3']), notificar),
    { org_id: 'org-1', codigo_pai: '00000010', canal_origem: null, reativar: true },
  );
  expect(enviados).toHaveLength(1);
  expect(enviados[0].texto).toContain('Kit 3');
  expect(enviados[0].texto).toContain('https://ml/kit3');
  expect(enviados[0].texto).not.toContain('Produto');
  expect(enviados[0].texto).not.toContain('https://ml/base');
});

it('base E kit reativando juntos avisam 2 vezes, cada um com seu contexto', async () => {
  const chamadas: Array<{ item: string; estoques: unknown }> = [];
  const enviados: Array<{ texto: string }> = [];
  const notificar = async (_admin: unknown, _org: string, _categoria: string, texto: string) => {
    enviados.push({ texto });
  };
  await processarSincronizacao(
    depsComReativacao(chamadas, new Set(['MLB-BASE', 'MLB-KIT3']), notificar),
    { org_id: 'org-1', codigo_pai: '00000010', canal_origem: null, reativar: true },
  );
  expect(enviados).toHaveLength(2);
  // Pareado por mensagem — não só "os dois textos apareceram em algum lugar" — pra pegar
  // cross-wiring (ex.: nome da base com permalink do kit).
  expect(enviados.some((e) => e.texto.includes('Produto') && e.texto.includes('https://ml/base'))).toBe(true);
  expect(enviados.some((e) => e.texto.includes('Kit 3') && e.texto.includes('https://ml/kit3'))).toBe(true);
});
