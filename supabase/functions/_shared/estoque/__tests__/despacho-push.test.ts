import { describe, it, expect } from 'vitest';
import { lerPushPendente, despacharPushPendente, type MovimentoPendente } from '../baixa';

/**
 * Outbox do ledger: quem drena os movimentos cujo push ainda não foi entregue ao QStash.
 *
 * ADR-0111 acrescentou a intenção "reposição" ao job. O agrupamento é o ponto sensível: uma venda
 * e uma entrada do MESMO produto têm políticas opostas (a venda no ML exclui o ML do push; a
 * entrada precisa alcançá-lo e ainda reativar o anúncio). Juntá-las despacharia uma com a
 * intenção da outra.
 */
function fakeAdmin(linhas: Array<Record<string, unknown>>) {
  const updates: Array<{ patch: Record<string, unknown>; ids: string[] }> = [];
  function chain() {
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      is: () => api,
      neq: () => api,
      order: () => api,
      limit: () => Promise.resolve({ data: linhas, error: null }),
      update: (patch: Record<string, unknown>) => {
        const alvo = { in: (_col: string, ids: string[]) => { updates.push({ patch, ids }); return Promise.resolve({ error: null }); } };
        return alvo;
      },
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { updates, client: { from: () => chain() } as any };
}

function coletor() {
  const jobs: Array<{ codigo_pai: string; canal_origem: string | null; reativar?: boolean; skus?: string[] }> = [];
  return {
    jobs,
    enfileirar: (job: {
      org_id: string; codigo_pai: string; canal_origem: string | null; reativar?: boolean; skus?: string[];
    }) => {
      jobs.push({
        codigo_pai: job.codigo_pai, canal_origem: job.canal_origem, reativar: job.reativar,
        ...(job.skus ? { skus: job.skus } : {}),
      });
      return Promise.resolve('msg-1');
    },
  };
}

const ORG = 'org-1';

describe('lerPushPendente — sinal da quantidade vira "reposição"', () => {
  it('quantidade positiva é reposição; negativa não é', async () => {
    const { client } = fakeAdmin([
      { id: 'm1', codigo_pai: 'P1', push_canal_origem: null, quantidade: 70 },
      { id: 'm2', codigo_pai: 'P1', push_canal_origem: 'mercado_livre', quantidade: -1 },
    ]);
    const pendentes = await lerPushPendente(client, ORG);
    expect(pendentes.map((p) => p.reposicao)).toEqual([true, false]);
  });

  // Ajuste (ADR-0110) só reduz: nunca pode reativar.
  it('quantidade nula ou ausente não é reposição', async () => {
    const { client } = fakeAdmin([
      { id: 'm1', codigo_pai: 'P1', push_canal_origem: null, quantidade: 0 },
      { id: 'm2', codigo_pai: 'P2', push_canal_origem: null },
    ]);
    const pendentes = await lerPushPendente(client, ORG);
    expect(pendentes.map((p) => p.reposicao)).toEqual([false, false]);
  });
});

describe('despacharPushPendente — a intenção de reposição chega no job', () => {
  const mov = (over: Partial<MovimentoPendente>): MovimentoPendente => ({
    id: 'm1', codigoPai: 'P1', canalOrigem: null, reposicao: false, skuRestrito: null, ...over,
  });

  it('entrada vira job com reativar: true', async () => {
    const { client } = fakeAdmin([]);
    const c = coletor();
    await despacharPushPendente(client, ORG, [mov({ reposicao: true })], c.enfileirar);
    expect(c.jobs).toEqual([{ codigo_pai: 'P1', canal_origem: null, reativar: true }]);
  });

  it('venda vira job com reativar: false', async () => {
    const { client } = fakeAdmin([]);
    const c = coletor();
    await despacharPushPendente(
      client, ORG, [mov({ canalOrigem: 'mercado_livre', reposicao: false })], c.enfileirar,
    );
    expect(c.jobs).toEqual([{ codigo_pai: 'P1', canal_origem: 'mercado_livre', reativar: false }]);
  });

  // O ponto da mudança de chave: sem `reposicao` no agrupamento, os dois virariam um job só.
  it('entrada e venda do mesmo produto não se misturam', async () => {
    const { client } = fakeAdmin([]);
    const c = coletor();
    await despacharPushPendente(client, ORG, [
      mov({ id: 'm1', reposicao: true }),
      mov({ id: 'm2', canalOrigem: 'mercado_livre', reposicao: false }),
    ], c.enfileirar);
    expect(c.jobs).toEqual([
      { codigo_pai: 'P1', canal_origem: null, reativar: true },
      { codigo_pai: 'P1', canal_origem: 'mercado_livre', reativar: false },
    ]);
  });

  // Duas entradas seguidas continuam sendo um job só: mesmo produto, mesma intenção.
  it('movimentos de mesma intenção seguem agrupados num job', async () => {
    const { client, updates } = fakeAdmin([]);
    const c = coletor();
    const r = await despacharPushPendente(client, ORG, [
      mov({ id: 'm1', reposicao: true }),
      mov({ id: 'm2', reposicao: true }),
    ], c.enfileirar);
    expect(c.jobs).toHaveLength(1);
    expect(r.marcados).toBe(2);
    expect(updates[0].ids).toEqual(['m1', 'm2']);
  });
});

/**
 * Incidente 03/09/2026 (MLB7157545794): a entrada de 40 un. da cor Preta recém-adicionada
 * enfileirou um push do produto INTEIRO. O saldo do app foi para todas as cores e zerou
 * Vermelho/Champagne/Marfim, cujo estoque o operador tinha lançado direto no ML — variação com
 * available_quantity 0 some da vitrine. Pedido do Diego: só o SKU criado vai ao canal.
 */
describe('push restrito ao SKU do fluxo "Adicionar variação"', () => {
  const mov = (over: Partial<MovimentoPendente>): MovimentoPendente => ({
    id: 'm1', codigoPai: 'P1', canalOrigem: null, reposicao: true, skuRestrito: null, ...over,
  });

  it('referencia addvar → lerPushPendente marca o SKU restrito; movimento comum não', async () => {
    const { client } = fakeAdmin([
      { id: 'm1', codigo: '26706151', codigo_pai: 'P1', push_canal_origem: null, quantidade: 40, referencia_externa: 'addvar:fam-1:26706151' },
      { id: 'm2', codigo: '18760901', codigo_pai: 'P1', push_canal_origem: null, quantidade: 40, referencia_externa: 'entrada manual' },
    ]);
    const pendentes = await lerPushPendente(client, ORG);
    expect(pendentes.map((p) => p.skuRestrito)).toEqual(['26706151', null]);
  });

  it('movimento addvar vira job com skus: [SKU]', async () => {
    const { client } = fakeAdmin([]);
    const c = coletor();
    await despacharPushPendente(client, ORG, [mov({ skuRestrito: '26706151' })], c.enfileirar);
    expect(c.jobs).toEqual([
      { codigo_pai: 'P1', canal_origem: null, reativar: true, skus: ['26706151'] },
    ]);
  });

  it('entrada comum continua sem skus (produto inteiro, comportamento de sempre)', async () => {
    const { client } = fakeAdmin([]);
    const c = coletor();
    await despacharPushPendente(client, ORG, [mov({})], c.enfileirar);
    expect(c.jobs).toEqual([{ codigo_pai: 'P1', canal_origem: null, reativar: true }]);
  });

  it('addvar não é agrupado com movimento comum do mesmo produto', async () => {
    const { client } = fakeAdmin([]);
    const c = coletor();
    await despacharPushPendente(client, ORG, [
      mov({ id: 'm1', skuRestrito: '26706151' }),
      mov({ id: 'm2' }),
    ], c.enfileirar);
    expect(c.jobs).toHaveLength(2);
    expect(c.jobs[0]!.skus).toEqual(['26706151']);
    expect(c.jobs[1]!.skus).toBeUndefined();
  });
});
