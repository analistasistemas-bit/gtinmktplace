import { describe, it, expect, vi, afterEach } from 'vitest';
import { removerPublicado } from '../processar';

// Fake admin client: fila FIFO por tabela, consumida na ordem real das queries do
// processar.ts (maybeSingle/then). delete()/update()/storage.remove() só gravam chamadas —
// nunca consomem a fila. Cobre só o que remover-publicado usa.
// ERRO(msg): marcador especial na fila — a próxima query nessa tabela resolve {data:null, error}.
const ERRO = (message: string) => ({ __erro: message });
function ehErro(v: unknown): v is { __erro: string } {
  return !!v && typeof v === 'object' && '__erro' in (v as Record<string, unknown>);
}

function fakeAdmin(filas: Record<string, unknown[]>) {
  const deletes: { tabela: string }[] = [];
  const updates: { tabela: string; payload: Record<string, unknown> }[] = [];
  const removidos: string[][] = [];

  const proximo = (tabela: string) => {
    const fila = filas[tabela] ?? [];
    return fila.length ? fila.shift() : [];
  };

  function chain(tabela: string): any {
    const obj: any = {
      select: () => obj,
      eq: () => obj,
      not: () => obj,
      limit: () => obj,
      in: () => obj,
      maybeSingle: async () => {
        const v = proximo(tabela);
        return ehErro(v) ? { data: null, error: { message: v.__erro } } : { data: v, error: null };
      },
      delete: () => {
        deletes.push({ tabela });
        const delObj: any = {
          eq: () => delObj,
          in: () => delObj,
          then: (resolve: any) => {
            const v = proximo(`${tabela}:delete`);
            return Promise.resolve(ehErro(v) ? { data: null, error: { message: v.__erro } } : { data: null, error: null }).then(resolve);
          },
        };
        return delObj;
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ tabela, payload });
        const updObj: any = {
          eq: () => updObj,
          in: () => updObj,
          then: (resolve: any) => {
            const v = proximo(`${tabela}:update`);
            return Promise.resolve(ehErro(v) ? { data: null, error: { message: v.__erro } } : { data: null, error: null }).then(resolve);
          },
        };
        return updObj;
      },
      then: (resolve: any) => {
        const v = proximo(tabela);
        return Promise.resolve(ehErro(v) ? { data: null, error: { message: v.__erro } } : { data: v, error: null }).then(resolve);
      },
    };
    return obj;
  }

  // ADR-0097: a varredura de movimentos órfãos roda por RPC. Registra a ORDEM junto com os
  // deletes — a varredura só é correta DEPOIS do delete das famílias (antes, o cascade
  // ainda não rodou e o conjunto órfão sai vazio).
  const rpcs: { nome: string; args: unknown; tabelasDeletadasAntes: string[] }[] = [];
  const admin: any = {
    from: (tabela: string) => chain(tabela),
    storage: { from: () => ({ remove: async (paths: string[]) => { removidos.push(paths); return { error: null }; } }) },
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args, tabelasDeletadasAntes: deletes.map((d) => d.tabela) });
      return { data: 0, error: null };
    },
  };
  return { admin, deletes, updates, removidos, rpcs };
}

const ORG = 'org-1';
const DONO = 'user-1'; // dono dos paths de Storage (1º segmento de pasta) — membro de ORG
const CANAL = 'mercado_livre';
const CTX = { getToken: async () => 'tok' } as never;
const CONEXAO = { id: 'c', contaExternaId: 'seller-1' } as never;

describe('removerPublicado — família User Products (ADR-0088: mini-saga de remoção)', () => {
  it('modo republicar pausa filhos, preserva família/imagens e limpa somente vínculos ML', async () => {
    const { admin, deletes, updates, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', lote_id: 'lote-40', codigo_pai: '02854309', ml_item_id: 'MLB1', org_id: ORG },
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: false }]],
      anuncios_externos_itens: [[
        { sku: 'TAM01', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'TAM02', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
        { sku: 'TAM03', item_externo_id: 'MLB3', retirado: false, status: 'ativo' },
      ]],
    });

    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO, removerComposicao: async () => ({ tipo: 'pronto_para_deletar' }) },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true } as never,
    );

    expect(r).toEqual({ tipo: 'preservada', familiaId: 'fam-1', loteId: 'lote-40' });
    expect(deletes.map((d) => d.tabela)).toEqual(['anuncios_externos']);
    expect(updates).toEqual(expect.arrayContaining([
      {
        tabela: 'familias',
        payload: expect.objectContaining({
          ml_item_id: null,
          status: 'pronto',
          operacao: 'CREATE',
          capa_ml_picture_id: null,
          capa2_ml_picture_id: null,
          capa3_ml_picture_id: null,
        }),
      },
      {
        tabela: 'variacoes',
        payload: expect.objectContaining({
          ml_variation_id: null,
          preco_publicado_ml: null,
          ml_picture_id: null,
        }),
      },
    ]));
    expect(removidos).toEqual([]);
  });

  it('todos os filhos confirmam pausado → deleta normalmente (fluxo idêntico ao Legacy)', async () => {
    const { admin, deletes, updates } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, // alvo
        [], // emVoo
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
      ]],
      lotes: [],
    });

    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO, removerComposicao: async () => ({ tipo: 'pronto_para_deletar' }) },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL },
    );

    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
    expect(updates).toEqual([]); // saga real faria os updates; aqui a saga é fake e não passou por salvarStatus
  });

  it('1+ filhos não confirmam pausado → remocao_pendente, NADA é deletado (raiz e filhas preservadas)', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
      ]],
    });

    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO, removerComposicao: async () => ({ tipo: 'incompleto', pendentes: ['B'] }) },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL },
    );

    expect(r).toEqual({ tipo: 'remocao_pendente', pendentes: ['B'] });
    expect(deletes).toEqual([]); // nada deletado — nem familias, nem anuncios_externos
  });

  it('família com filhos UP ativos SEM ctx/conexao → lança (nunca tenta pausar sem token)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[{ sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' }]],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/conexão com o Mercado Livre/);
  });

  it('erro ao consultar filhos UP → lança (fail-closed, nunca vira "não é UP" em silêncio)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }]],
    });
    const originalFrom = admin.from;
    admin.from = (tabela: string) => {
      if (tabela === 'anuncios_externos_itens') {
        return { select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'timeout' } }) }) };
      }
      return originalFrom(tabela);
    };
    await expect(removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/consultar filhos UP falhou/);
  });

  it('raiz UP existe mas SEM linhas filhas (família UP já esvaziada) → remove normalmente, SEM exigir ctx/conexao', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[]], // raiz existe mas sem filhos (nunca teve, ou já removidos)
      lotes: [],
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }); // sem ctx/conexao — não deveria precisar
    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
  });

  it('família sem anuncios_externos (nunca publicada por esse canal): não bloqueia por UP', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[]],
      lotes: [],
    });

    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toContain('familias');
  });

  // Revisão Codex: crash no MEIO de uma mudança de composição pode deixar um filho `retirado=true`
  // já ATIVO no ML (crash entre ativar-remoto e marcarAtivo) ou `criacao_incerta` com POST real já
  // feito. `mudando_composicao=true` cobre as duas janelas por completo (ligado ANTES de qualquer
  // mutação remota, só limpo DEPOIS de tudo confirmado) — bloquear aqui evita confiar em
  // `retirado`/`itemExternoId` ambíguos durante essa janela.
  it('raiz com mudando_composicao=true → bloqueia (em_voo), nunca confia em retirado/itemExternoId ambíguos', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: true }]],
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]);
  });

  // Revisão Codex round 2 (TOCTOU): uma composição pode começar DEPOIS do gate inicial mas ANTES
  // do delete local — a re-checagem imediatamente antes do delete pega essa janela.
  it('re-checagem imediatamente antes do delete: composição começou DEPOIS do gate inicial → aborta (em_voo), nada deletado', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      // 1ª leitura (gate inicial): mudando_composicao=false. 2ª leitura (re-check pré-delete): true.
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: true }]],
      anuncios_externos_itens: [[]], // UP-esvaziada — sem filhos, pula direto pro delete
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]); // nada deletado — a composição que começou no meio-tempo é protegida
  });

  // Revisão Codex round 3: a re-checagem original rodava DEPOIS do storage.remove(paths) — mesmo
  // abortando o delete do banco, as FOTOS já teriam sido apagadas (irreversível, diferente de "não
  // deletar a linha"). Fix: re-check roda ANTES de qualquer ação destrutiva, storage incluído.
  it('re-checagem roda ANTES de remover fotos do Storage — aborta sem apagar nenhum arquivo', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: `${DONO}/capas/x.jpg`, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: true }]],
      anuncios_externos_itens: [[]],
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]);
    expect(removidos).toEqual([]); // fotos NUNCA removidas — a re-checagem abortou antes
  });
});

describe('removerPublicado — fail-closed em erros de query/delete (revisão Codex)', () => {
  it('erro ao consultar a família alvo → lança', async () => {
    const { admin } = fakeAdmin({ familias: [ERRO('timeout')] });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/consultar família falhou/);
  });

  it('erro ao consultar em_voo → lança', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, ERRO('timeout')],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/consultar em_voo falhou/);
  });

  it('erro ao consultar anuncios_externos → lança (nunca vira "sem filhos UP" em silêncio)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [ERRO('timeout')],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/consultar anuncios_externos falhou/);
  });

  it('erro ao listar famílias pra excluir → lança (nunca reporta ok sem remover nada)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, [], ERRO('timeout')],
      anuncios_externos: [[]],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/listar famílias pra excluir falhou/);
  });

  it('erro ao deletar familias → lança', async () => {
    const { admin } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      anuncios_externos: [[]],
      'familias:delete': [ERRO('constraint')],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/deletar familias falhou/);
  });

  it('erro ao deletar anuncios_externos → lança', async () => {
    const { admin } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      anuncios_externos: [[]],
      'anuncios_externos:delete': [ERRO('timeout')],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/deletar anuncios_externos falhou/);
  });
});

describe('removerPublicado — família Legacy (regressão: comportamento de hoje inalterado)', () => {
  it('raiz em anuncios_externos mas SEM linhas em anuncios_externos_itens: remove normalmente', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, // alvo
        [], // emVoo
        [{ // paraExcluir
          id: 'fam-1', lote_id: 'lote-1', user_id: DONO,
          capa_storage_path: `${DONO}/capas/x.jpg`, capa2_storage_path: null, capa3_storage_path: null,
          variacoes: [{ imagem_path: `${DONO}/imgs/y.jpg` }],
        }],
        [], // rest do lote (recontarOuRemoverLote) → lote fica vazio
      ],
      anuncios_externos: [[{ id: 'ext-1' }]], // raiz existe (legacy também grava aqui)
      anuncios_externos_itens: [[]], // mas SEM filho técnico UP
      lotes: [],
    });

    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') {
      expect(r.familiasRemovidas).toBe(1);
      expect(r.lotesRemovidos).toBe(1);
    }
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
    expect(removidos).toEqual([[`${DONO}/capas/x.jpg`, `${DONO}/imgs/y.jpg`]]);
  });

  // Guard de posse (F1): `capa*_storage_path` é editável por QUALQUER membro da org via RLS
  // ("familias: update org"), e este remove roda com service_role — a RLS de storage, que só
  // permite apagar sob o próprio prefixo, não se aplica. O dono aceito é o da PRÓPRIA família:
  // travar na org seria mais frouxo que a RLS substituída e deixaria um membro apagar arquivo
  // de um colega. Aqui o path do colega (mesma org) e o de outro tenant são ambos recusados.
  it('só apaga arquivo sob o prefixo do dono da própria família', async () => {
    const { admin, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
        [{
          id: 'fam-1', lote_id: 'lote-1', user_id: DONO,
          capa_storage_path: `${DONO}/capas/legitima.jpg`,
          capa2_storage_path: 'colega-da-mesma-org/capas/vitima.jpg',
          capa3_storage_path: 'usuario-de-outra-org/capas/vitima.jpg',
          variacoes: [],
        }],
        [],
      ],
      anuncios_externos: [[]],
      anuncios_externos_itens: [[]],
      lotes: [],
    });

    await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(removidos).toEqual([[`${DONO}/capas/legitima.jpg`]]);
  });
});

// ADR-0097 — a exclusão não pode deixar movimento de estoque órfão no ledger.
describe('removerPublicado — varredura de movimentos órfãos (ADR-0097)', () => {
  const cenarioRemove = () => fakeAdmin({
    familias: [
      { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
      [],
      [{
        id: 'fam-1', lote_id: 'lote-1', user_id: DONO,
        capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null,
        variacoes: [],
      }],
      [],
    ],
    anuncios_externos: [[]],
    anuncios_externos_itens: [[]],
    lotes: [],
  });

  it('varre os órfãos da org DEPOIS de deletar as famílias', async () => {
    const { admin, rpcs } = cenarioRemove();

    await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].nome).toBe('limpar_movimentos_orfaos');
    expect(rpcs[0].args).toEqual({ p_org: ORG });
    // A ordem é a regra: antes do delete o cascade das variações ainda não rodou e o
    // conjunto órfão sairia vazio — a varredura não limparia nada.
    expect(rpcs[0].tabelasDeletadasAntes).toContain('familias');
  });

  it('falha da varredura NÃO derruba a exclusão já commitada', async () => {
    const { admin } = cenarioRemove();
    admin.rpc = async () => ({ data: null, error: { message: 'boom' } });

    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(r.tipo).toBe('ok');
  });

  it('modo republicar preserva a família — e portanto NÃO varre', async () => {
    // Legacy sem filhos UP: o modo republicar agora pausa o anúncio raiz por GET+PUT no fetch
    // global — item já pausado dispensa o PUT, e o teste segue focado só na varredura.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status: 'paused' }), { status: 200 })));
    const { admin, rpcs } = fakeAdmin({
      familias: [
        { id: 'fam-1', lote_id: 'lote-40', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: false }]],
      anuncios_externos_itens: [[]],
    });

    await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, {
      familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true,
    });
    vi.unstubAllGlobals();

    // O SKU continua vivo: varrer aqui apagaria o histórico de um produto que só está
    // sendo republicado.
    expect(rpcs).toEqual([]);
  });
});

describe('removerPublicado — casos já existentes (regressão)', () => {
  it('família não encontrada', async () => {
    const { admin } = fakeAdmin({ familias: [null] });
    const r = await removerPublicado({ admin }, { familiaId: 'x', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('nao_encontrada');
  });

  it('família sem ml_item_id → não publicada', async () => {
    const { admin } = fakeAdmin({ familias: [{ id: 'fam-1', codigo_pai: '000', ml_item_id: null, org_id: ORG }] });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('nao_publicada');
  });

  it('há família em publicando → em_voo', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG },
        [{ id: 'fam-2' }], // emVoo não vazio
      ],
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]);
  });
});

// Modo republicar em família Legacy (sem filhos UP): a saga não roda, então o PRÓPRIO anúncio
// raiz precisa ser pausado no ML antes de cortar o vínculo local — senão ele fica ativo e órfão
// no ML e a republicação (CREATE) gera um duplicado. GET primeiro decide: active → PUT pausar;
// já pausado/closed/moderado → nada a pausar; 404/410 → item já sumiu, seguro seguir; erro
// transiente no GET ou no PUT → aborta SEM tocar nada local (fail-closed, operador tenta de novo).
describe('removerPublicado — modo republicar pausa o anúncio raiz (família Legacy)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const cenarioLegacy = () => fakeAdmin({
    familias: [
      { id: 'fam-1', lote_id: 'lote-40', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
      [],
    ],
    anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: false }]],
    anuncios_externos_itens: [[]], // Legacy: raiz existe mas sem filho técnico UP
  });

  it('anúncio ativo → GET + PUT pausar no ML, depois preserva e corta vínculos', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: { method?: string; body?: string }) => {
      if (opts?.method === 'PUT') { puts.push(String(opts.body)); return new Response('{}', { status: 200 }); }
      return new Response(JSON.stringify({ status: 'active' }), { status: 200 });
    }));
    const { admin, updates } = cenarioLegacy();
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r).toEqual({ tipo: 'preservada', familiaId: 'fam-1', loteId: 'lote-40' });
    expect(puts).toEqual([JSON.stringify({ status: 'paused' })]);
    expect(updates).toEqual(expect.arrayContaining([
      { tabela: 'familias', payload: expect.objectContaining({ ml_item_id: null, status: 'pronto' }) },
    ]));
  });

  it('anúncio já pausado/closed → segue SEM PUT (pausar closed daria 400 e travaria a recuperação)', async () => {
    const fetchFake = vi.fn(async (_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') throw new Error('PUT não deveria acontecer');
      return new Response(JSON.stringify({ status: 'closed' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchFake);
    const { admin } = cenarioLegacy();
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r.tipo).toBe('preservada');
  });

  it('item já sumiu no ML (404) → segue sem pausar (recuperação de anúncio morto)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })));
    const { admin } = cenarioLegacy();
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r.tipo).toBe('preservada');
  });

  it('GET transiente (500) → lança e NADA local é alterado (fail-closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const { admin, updates, deletes } = cenarioLegacy();
    await expect(removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    )).rejects.toThrow(/consultar anúncio no ML falhou/);
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('PUT pausar falha (500) → lança e NADA local é alterado (item de outro seller cai aqui via 403)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return new Response('{"message":"boom"}', { status: 500 });
      return new Response(JSON.stringify({ status: 'active' }), { status: 200 });
    }));
    const { admin, updates, deletes } = cenarioLegacy();
    await expect(removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    )).rejects.toThrow();
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('sem ctx/conexao → lança (nunca corta o vínculo sem conseguir pausar)', async () => {
    const { admin, updates } = cenarioLegacy();
    await expect(removerPublicado(
      { admin },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    )).rejects.toThrow(/conexão com o Mercado Livre/);
    expect(updates).toEqual([]);
  });
});

// Confirmação (nível de integração de portas): a saga REAL de remoção também confirma pausado
// por GET — nunca confia no PUT sem erro. Aqui exercitamos removerComposicaoUP via processar.ts
// com um fetchLike fake, provando que o `confirmar` construído aqui (sem checagem de family_id,
// diferente do da composição) aceita um item pausado com family_id ausente.
describe('removerPublicado — integração das portas reais (sem removerComposicao injetado)', () => {
  // `pausar` fecha sobre `atualizarStatusML`, que usa o `fetch` global direto (sem injeção) —
  // diferente de `confirmar` (via `buscarItemUP`, que aceita `fetchLike`). Stub global só aqui,
  // pra provar que a PORTA REAL construída em processar.ts (não um fake da saga) funciona
  // ponta a ponta, incluindo o `confirmar` sem checagem de family_id (Opus: o da composição
  // bloquearia um item genuinamente pausado com family_id ausente/lagado).
  afterEach(() => { vi.unstubAllGlobals(); });

  it('GET confirma status=paused mesmo sem family_id → pronto pra deletar (não usa o confirmar da composição, que bloquearia)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/description')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ status: 'paused', seller_id: 'seller-1' }), { status: 200 });
    }));
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[{ sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' }]],
      lotes: [],
    });
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
  });

  it('GET confirma item de OUTRO seller → remocao_pendente (inesperado, terminal)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status: 'active', seller_id: 'outro-seller' }), { status: 200 })));
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[{ sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' }]],
    });
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r).toEqual({ tipo: 'remocao_pendente', pendentes: ['A'] });
    expect(deletes).toEqual([]);
  });

  // Revisão Codex: seller_id AUSENTE no GET não prova posse — operação destrutiva precisa ser
  // fail-closed na identidade, não assumir "ok" só por não ter achado divergência explícita.
  it('GET confirma status=paused mas SEM seller_id no corpo → remocao_pendente (fail-closed, identidade não confirmada)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status: 'paused' }), { status: 200 }))); // sem seller_id
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[{ sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' }]],
    });
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r).toEqual({ tipo: 'remocao_pendente', pendentes: ['A'] });
    expect(deletes).toEqual([]);
  });

  it('TRY-ALL sobrevive a erro de PUT (pausar) real: um filho falha, o outro é tentado e a remoção fica pendente pros dois corretamente', async () => {
    let chamadas = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: { method?: string }) => {
      chamadas++;
      if (opts?.method === 'PUT' && url.includes('MLB1')) return new Response('{}', { status: 500 }); // pausar MLB1 falha
      if (opts?.method === 'PUT') return new Response('{}', { status: 200 }); // pausar MLB2 ok
      return new Response(JSON.stringify({ status: 'paused', seller_id: 'seller-1' }), { status: 200 }); // GET
    }));
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
      ]],
    });
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r).toEqual({ tipo: 'remocao_pendente', pendentes: ['A'] }); // só A pendente; B foi pausado+confirmado
    expect(deletes).toEqual([]);
    expect(chamadas).toBeGreaterThan(2); // ambos os filhos foram tentados (não parou no 1º)
  });
});
