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
      order: () => obj, // listarKitsVivos (guard D-10/D-14) termina em .order()
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

/** Stub de fetch ML para Remover (ADR-0168): GET sold_quantity + PUT closed/deleted. */
function stubFetchML(
  config: Record<string, { sold_quantity?: number; status?: string; getStatus?: number }>,
  opts?: { putStatus?: number; failId?: string },
) {
  const excluidos = new Set<string>();
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const m = url.match(/items\/(MLB[^/?]+)/);
    const id = m?.[1];
    if (init?.method === 'PUT' && id) {
      if (opts?.failId === id) return new Response('{}', { status: opts.putStatus ?? 500 });
      const body = JSON.parse(init.body ?? '{}');
      if (body.deleted) { excluidos.add(id); return new Response('{}', { status: 200 }); }
      return new Response('{}', { status: 200 });
    }
    const cfg = id ? config[id] : undefined;
    if (!cfg) return new Response('{}', { status: 404 });
    if (cfg.getStatus) return new Response('{}', { status: cfg.getStatus });
    if (excluidos.has(id!)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({
      id,
      sold_quantity: cfg.sold_quantity ?? 0,
      status: cfg.status ?? 'active',
      sub_status: [],
      variations: [],
      pictures: [],
    }), { status: 200 });
  });
}

function depsRemoverML(admin: unknown, ids: string[]) {
  const cfg = Object.fromEntries(ids.map((id) => [id, { sold_quantity: 0 }]));
  vi.stubGlobal('fetch', stubFetchML(cfg));
  return { admin, ctx: CTX, conexao: CONEXAO };
}

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

  it('Remover UP: todos sold_quantity=0 → encerra todos os filhos + delete local', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', stubFetchML({ MLB1: { sold_quantity: 0 }, MLB2: { sold_quantity: 0 } }));
    const fetchOrig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (init?.method === 'PUT') puts.push(String(init.body));
      return fetchOrig(url, init);
    }) as typeof fetch;
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [], [], 
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

    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();

    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
    expect(puts.filter((p) => p.includes('"status":"closed"'))).toHaveLength(2);
    expect(puts.filter((p) => p.includes('"deleted"'))).toHaveLength(2);
  });

  it('republicar: 1+ filhos não confirmam pausado → remocao_pendente, NADA é deletado', async () => {
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
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );

    expect(r).toEqual({ tipo: 'remocao_pendente', pendentes: ['B'] });
    expect(deletes).toEqual([]);
  });

  it('Remover com filhos UP SEM ctx/conexao → lança (ADR-0168 D-5)', async () => {
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

  it('raiz UP esvaziada → Remover exige ctx e encerra ml_item_id no ML', async () => {
    const cenario = () => fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [], [],
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[]],
      lotes: [],
    });
    const { admin: adminSemCtx } = cenario();
    await expect(removerPublicado({ admin: adminSemCtx }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/conexão com o Mercado Livre/);
    const { admin, deletes } = cenario();
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
  });

  it('família Legacy sem anuncios_externos: Remover exige ctx e consulta ML', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [], [],
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[]],
      lotes: [],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
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
        [], // kits vivos (guard D-14) — nenhum
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      // 1ª leitura (gate inicial): mudando_composicao=false. 2ª leitura (re-check pré-delete): true.
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: true }]],
      anuncios_externos_itens: [[]], // UP-esvaziada — sem filhos, pula direto pro delete
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]);
  });

  // Revisão Codex round 3: a re-checagem original rodava DEPOIS do storage.remove(paths) — mesmo
  // abortando o delete do banco, as FOTOS já teriam sido apagadas (irreversível, diferente de "não
  // deletar a linha"). Fix: re-check roda ANTES de qualquer ação destrutiva, storage incluído.
  it('re-checagem roda ANTES de remover fotos do Storage — aborta sem apagar nenhum arquivo', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, [],
        [], // kits vivos (guard D-14) — nenhum
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: `${DONO}/capas/x.jpg`, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: true }]],
      anuncios_externos_itens: [[]],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]);
    expect(removidos).toEqual([]);
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

  // ADR-0151 D-14: ao contrário de `listarKitsVivos` (fail-open, usado pelo push), esta
  // consulta é inline e fail-closed — o que vem depois é irreversível (pausa no ML, fotos
  // apagadas do Storage).
  it('erro ao consultar kits vinculados → lança (nunca vira "sem kit" em silêncio)', async () => {
    const { admin } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG, kit_multiplicador: null },
        [],
        ERRO('timeout'),
      ],
    });
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/consultar kits vinculados falhou/);
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
      familias: [{ id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, [], [], ERRO('timeout')],
      anuncios_externos: [[]],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    await expect(removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/listar famílias pra excluir falhou/);
    vi.unstubAllGlobals();
  });

  it('erro ao deletar familias → lança', async () => {
    const { admin } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, [],
        [], // kits vivos (guard D-14) — nenhum
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      anuncios_externos: [[]],
      'familias:delete': [ERRO('constraint')],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    await expect(removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/deletar familias falhou/);
    vi.unstubAllGlobals();
  });

  it('erro ao deletar anuncios_externos → lança', async () => {
    const { admin } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG }, [],
        [], // kits vivos (guard D-14) — nenhum
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      ],
      anuncios_externos: [[]],
      'anuncios_externos:delete': [ERRO('timeout')],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    await expect(removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/deletar anuncios_externos falhou/);
    vi.unstubAllGlobals();
  });
});

describe('removerPublicado — família Legacy (regressão)', () => {
  it('raiz em anuncios_externos mas SEM linhas em anuncios_externos_itens: remove normalmente', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, // alvo
        [], // emVoo
        [], // kits vivos (guard D-14) — nenhum
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

    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();

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
        [], // kits vivos (guard D-14) — nenhum
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

    const deps = depsRemoverML(admin, ['MLB1']);
    await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();

    expect(removidos).toEqual([[`${DONO}/capas/legitima.jpg`]]);
  });
});

// ADR-0097 — a exclusão não pode deixar movimento de estoque órfão no ledger.
describe('removerPublicado — varredura de movimentos órfãos (ADR-0097)', () => {
  const cenarioRemove = () => fakeAdmin({
    familias: [
      { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
      [],
      [], // kits vivos (guard D-14) — nenhum
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

    const deps = depsRemoverML(admin, ['MLB1']);
    await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();

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

    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();

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

// ADR-0151 D-14: base com kit vinculado ativo não é removível — o kit venderia contra uma base
// que não existe mais e a venda não teria onde debitar. Guard roda ANTES da mini-saga UP (nunca
// pausa nada no ML só para descobrir depois que não pode deletar).
describe('removerPublicado — guard D-14: base com kit vinculado ativo (ADR-0151)', () => {
  it('remover base com kit vinculado ativo é recusado', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00000010', ml_item_id: 'MLB1', org_id: ORG, kit_multiplicador: null }, // alvo
        [], // emVoo
        [{ codigo_pai: '00000020', kit_multiplicador: 3 }], // consulta de kits vinculados
      ],
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r).toEqual({ tipo: 'kit_vinculado_ativo', kits: [{ codigoPai: '00000020', multiplicador: 3 }] });
    expect(deletes).toEqual([]); // nada tocado — nem a mini-saga UP chegou a rodar
  });

  // A DB só devolve kits em STATUS_KIT_VIVO ('pronto'/'publicando'/'publicado') — um kit em
  // 'erro' nunca aparece na resposta real desta consulta (filtro `.in('status', ...)`,
  // verificado contra Postgres real no Step 2 da task). Aqui a fila vazia simula exatamente
  // essa resposta e prova que o código NÃO bloqueia quando não há kit vivo.
  it('kit em erro NÃO bloqueia — a base segue removível (a consulta já filtra fora)', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00000010', ml_item_id: 'MLB1', org_id: ORG, kit_multiplicador: null },
        [], // emVoo
        [], // consulta de kits vinculados — vazia, como a DB devolveria com o único kit em 'erro'
      ],
      anuncios_externos: [[]],
      lotes: [],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).not.toBe('kit_vinculado_ativo');
  });
});

// ADR-0154 D-13: componente de Kit Virtual publicado não pode ser removido nem republicado —
// republicar geraria um user_product_id novo e o kit ficaria preso ao UP morto (out_of_stock
// permanente, sem erro nenhum). Guard de app: roda ANTES de qualquer mutação, comum aos dois
// ramos (remover e preservarFamilia passam pelo mesmo `return` antes da bifurcação).
//
// `kitsVirtuaisPublicadosBloqueando` faz DUAS queries simples (`kits_virtuais` filtrado por
// status, depois `kits_virtuais_componentes` filtrado por `kit_id in (...)`) — o match por
// `codigo_pai`/`item_externo_id` roda em JS aqui no processar.ts, não dentro de um `.or()` que
// o fake só ecoaria. Isso é o que faz estes testes exercitarem de verdade a lógica de match, e
// não só a fixture: a query 1 (por status) é limitação do fake — o fake não filtra por `.eq()`,
// então "encerrado"/"erro não bloqueiam" só provam o curto-circuito de `kits.length===0`
// (o que a query real produziria depois de filtrar por status). Essa parte (o WHERE real)
// só é verificada contra Postgres de verdade após `db push` — fora de escopo desta task.
describe('removerPublicado — guard D-13: componente de Kit Virtual publicado (ADR-0154)', () => {
  const cenarioBase = () => ({
    familias: [
      { id: 'fam-1', codigo_pai: '00099999', ml_item_id: 'MLB1', org_id: ORG, kit_multiplicador: null },
      [], // emVoo
      [], // kits vinculados (guard D-14) — nenhum
    ],
    anuncios_externos: [[]], // Legacy, sem filhos UP — só codigo_pai/ml_item_id entram no match
  });

  it('remover: componente de kit virtual publicado (match por codigo_pai) é recusado, nada é tocado', async () => {
    const { admin, deletes, updates } = fakeAdmin({
      ...cenarioBase(),
      kits_virtuais: [[{ id: 'kit-1', titulo: 'Kit Verão' }]],
      kits_virtuais_componentes: [[{ kit_id: 'kit-1', codigo_pai: '00099999', item_externo_id: null }]],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r).toEqual({ tipo: 'kit_virtual_publicado', kits: ['Kit Verão'] });
    expect(deletes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('republicar (preservarFamilia): componente de kit virtual publicado também é recusado', async () => {
    const { admin, deletes, updates } = fakeAdmin({
      ...cenarioBase(),
      kits_virtuais: [[{ id: 'kit-1', titulo: 'Kit Verão' }]],
      kits_virtuais_componentes: [[{ kit_id: 'kit-1', codigo_pai: '00099999', item_externo_id: null }]],
    });
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r).toEqual({ tipo: 'kit_virtual_publicado', kits: ['Kit Verão'] });
    expect(deletes).toEqual([]);
    expect(updates).toEqual([]);
  });

  // Prova real do match (não fixture-eco): dois kits publicados na org, só UM tem componente
  // deste produto — só o título dele volta. Se o código ignorasse o match e devolvesse todo
  // kit publicado da org, este teste cairia.
  it('só devolve o(s) kit(s) cujo componente realmente casa — não todo kit publicado da org', async () => {
    const { admin } = fakeAdmin({
      ...cenarioBase(),
      kits_virtuais: [[{ id: 'kit-1', titulo: 'Kit Verão' }, { id: 'kit-2', titulo: 'Kit Sem Relação' }]],
      kits_virtuais_componentes: [[
        { kit_id: 'kit-1', codigo_pai: '00099999', item_externo_id: null }, // casa
        { kit_id: 'kit-2', codigo_pai: '00000001', item_externo_id: 'MLB-outro' }, // não casa
      ]],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r).toEqual({ tipo: 'kit_virtual_publicado', kits: ['Kit Verão'] });
  });

  // A query real (`kits_virtuais` filtrada por `status='publicado'`) é o que exclui um kit
  // 'encerrado' ou 'erro' da resposta — quando ela devolve vazio, o guard sequer chega a
  // consultar `kits_virtuais_componentes` (curto-circuito em `kits.length===0`).
  it('componente de kit encerrado NÃO bloqueia — nenhum kit publicado na org (curto-circuito)', async () => {
    const { admin, deletes } = fakeAdmin({
      ...cenarioBase(),
      familias: [
        ...cenarioBase().familias,
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      kits_virtuais: [[]], // nenhum kit 'publicado' — o encerrado já saiu na query real
      anuncios_externos_itens: [[]],
      lotes: [],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
  });

  it('componente de kit em erro NÃO bloqueia — mesma razão (nenhum kit publicado)', async () => {
    const { admin, deletes } = fakeAdmin({
      ...cenarioBase(),
      familias: [
        ...cenarioBase().familias,
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      kits_virtuais: [[]],
      anuncios_externos_itens: [[]],
      lotes: [],
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).toBe('ok');
  });

  it('família sem nenhuma relação com kit virtual → permite normalmente (fila vazia por omissão)', async () => {
    const { admin, deletes } = fakeAdmin({
      ...cenarioBase(),
      familias: [
        ...cenarioBase().familias,
        [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos_itens: [[]],
      lotes: [],
      // kits_virtuais OMITIDO de propósito: fila ausente resolve como [] (nenhum kit publicado).
    });
    const deps = depsRemoverML(admin, ['MLB1']);
    const r = await removerPublicado(deps, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    vi.unstubAllGlobals();
    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
  });

  it('família UP com filhos: guard casa por item_externo_id de um filho (não pelo codigo_pai)', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00099999', ml_item_id: 'MLB1', org_id: ORG, kit_multiplicador: null },
        [],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' }, // componente do kit
      ]],
      kits_virtuais: [[{ id: 'kit-1', titulo: 'Kit Combo' }]],
      // codigo_pai DIVERGENTE de propósito: só o item_externo_id (do filho B, não da raiz) casa.
      kits_virtuais_componentes: [[{ kit_id: 'kit-1', codigo_pai: '00000000', item_externo_id: 'MLB2' }]],
    });
    vi.stubGlobal('fetch', stubFetchML({ MLB1: {}, MLB2: {} }));
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL },
    );
    vi.unstubAllGlobals();
    expect(r).toEqual({ tipo: 'kit_virtual_publicado', kits: ['Kit Combo'] });
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

// Republicar: integração das portas reais de pausa (removerComposicaoUP sem injeção).
describe('removerPublicado — republicar integração das portas reais de pausa', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('GET confirma status=paused → preservada (republicar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/description')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ status: 'paused', seller_id: 'seller-1' }), { status: 200 });
    }));
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', lote_id: 'l1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }], [{ mudando_composicao: false }]],
      anuncios_externos_itens: [[{ sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' }]],
    });
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r.tipo).toBe('preservada');
    expect(deletes.map((d) => d.tabela)).toEqual(['anuncios_externos']);
  });

  it('GET confirma item de OUTRO seller → remocao_pendente (republicar)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status: 'active', seller_id: 'outro-seller' }), { status: 200 })));
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[{ sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' }]],
    });
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r).toEqual({ tipo: 'remocao_pendente', pendentes: ['A'] });
    expect(deletes).toEqual([]);
  });
});

// Incidente 2026-09-10 (kit do Ninho): em UP `familias.ml_item_id` só é gravado quando a saga chega
// a `ativo`; uma saga interrompida deixa filhos VIVOS no ML sem esse campo. Desde o guard do mesmo
// dia, essa família também não pode ser EXCLUÍDA (o item remoto recusa) — se aqui ela continuasse
// caindo em `nao_publicada`, ficaria presa nas duas portas, com anúncio vivo lá fora.
describe('removerPublicado — família UP sem ml_item_id mas com filho vivo no ML', () => {
  it('não responde "nao_publicada": o filho com item_externo_id é a prova de publicação', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00000098', ml_item_id: null, org_id: ORG }, // alvo, saga interrompida
        [], // emVoo
        [], // kits vivos (guard D-14)
        [], // paraExcluir por ml_item_id → vazia (é justamente o buraco)
        [{ // releitura da própria família alvo
          id: 'fam-1', lote_id: 'lote-1', user_id: DONO,
          capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null,
          variacoes: [{ imagem_path: null }],
        }],
        [], // resto do lote → lote vazio
      ],
      // 1ª leitura: prova de filho vivo (o guard novo). Depois o fluxo normal de UP.
      anuncios_externos: [
        [{ anuncios_externos_itens: [{ item_externo_id: 'MLB5210027027' }] }],
        [{ id: 'ext-1', mudando_composicao: false }],
        [{ mudando_composicao: false }],
      ],
      anuncios_externos_itens: [[]], // sem filhos ativos p/ pausar: cai no caminho já coberto
      lotes: [],
    });

    vi.stubGlobal('fetch', stubFetchML({ MLB5210027027: { sold_quantity: 0 } }));
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL },
    );
    vi.unstubAllGlobals();

    expect(r.tipo).not.toBe('nao_publicada');
    expect(deletes.map((d) => d.tabela)).toContain('familias');
  });

  it('sem ml_item_id E sem filho vivo continua "nao_publicada" (nada existe no ML)', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [{ id: 'fam-1', codigo_pai: '00000098', ml_item_id: null, org_id: ORG }],
      anuncios_externos: [[{ anuncios_externos_itens: [{ item_externo_id: null }] }]],
    });
    const r = await removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('nao_publicada');
    expect(deletes).toEqual([]);
  });
});

describe('removerPublicado — ADR-0168 (Remover encerra no ML só sem venda)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const cenarioLegacy = () => fakeAdmin({
    familias: [
      { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
      [], [],
      [{ id: 'fam-1', lote_id: 'lote-1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
      [],
    ],
    anuncios_externos: [[]],
    anuncios_externos_itens: [[]],
    lotes: [],
  });

  it('1. Legacy sold_quantity=0 → closed + deleted + delete local ok', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', stubFetchML({ MLB1: { sold_quantity: 0 } }));
    const fetchOrig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (init?.method === 'PUT') puts.push(String(init.body));
      return fetchOrig(url, init);
    }) as typeof fetch;
    const { admin, deletes } = cenarioLegacy();
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('ok');
    expect(puts.some((p) => p.includes('"status":"closed"'))).toBe(true);
    expect(puts.some((p) => p.includes('"deleted"'))).toBe(true);
    expect(deletes.map((d) => d.tabela)).toContain('familias');
  });

  it('2. Legacy sold_quantity>0 → tem_movimentacao, zero PUT destrutivo, zero delete local', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') { puts.push(String(init.body)); return new Response('{}', { status: 200 }); }
      return new Response(JSON.stringify({
        id: 'MLB1', sold_quantity: 3, status: 'active', sub_status: [], variations: [], pictures: [],
      }), { status: 200 });
    }));
    const { admin, deletes } = cenarioLegacy();
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r).toEqual({ tipo: 'tem_movimentacao' });
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('3. UP: 1 filho sold_quantity>0 e outros 0 → bloqueia tudo', async () => {
    vi.stubGlobal('fetch', stubFetchML({ MLB1: { sold_quantity: 0 }, MLB2: { sold_quantity: 2 } }));
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, [], [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
      ]],
      lotes: [],
    });
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r).toEqual({ tipo: 'tem_movimentacao' });
    expect(deletes).toEqual([]);
  });

  it('4. UP todos sold_quantity=0 → encerra todos + delete local', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', stubFetchML({ MLB1: { sold_quantity: 0 }, MLB2: { sold_quantity: 0 } }));
    const fetchOrig = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (init?.method === 'PUT') puts.push(String(init.body));
      return fetchOrig(url, init);
    }) as typeof fetch;
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, [], [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
      ]],
      lotes: [],
    });
    const r = await removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('ok');
    expect(puts.filter((p) => p.includes('"status":"closed"'))).toHaveLength(2);
    expect(deletes.map((d) => d.tabela)).toContain('familias');
  });

  it('5. GET 5xx no meio → não deleta local', async () => {
    vi.stubGlobal('fetch', stubFetchML({ MLB1: { getStatus: 500 } }));
    const { admin, deletes } = cenarioLegacy();
    await expect(removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/consultar anúncio MLB1 no ML falhou/);
    expect(deletes).toEqual([]);
  });

  it('5b. UP: PUT deleted falha no 2º filho → lança, zero delete local', async () => {
    vi.stubGlobal('fetch', stubFetchML(
      { MLB1: { sold_quantity: 0 }, MLB2: { sold_quantity: 0 } },
      { failId: 'MLB2', putStatus: 500 },
    ));
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, [], [],
        [{ id: 'fam-1', lote_id: 'l1', user_id: DONO, capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[{ id: 'ext-1' }], [{ mudando_composicao: false }]],
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', retirado: false, status: 'ativo' },
        { sku: 'B', item_externo_id: 'MLB2', retirado: false, status: 'ativo' },
      ]],
      lotes: [],
    });
    await expect(removerPublicado({ admin, ctx: CTX, conexao: CONEXAO }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow();
    expect(deletes).toEqual([]);
  });

  it('6. Republicar (preservarFamilia) com active → ainda pausa (regressão)', async () => {
    const puts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') { puts.push(String(init.body)); return new Response('{}', { status: 200 }); }
      return new Response(JSON.stringify({ status: 'active' }), { status: 200 });
    }));
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', lote_id: 'l40', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, []],
      anuncios_externos: [[{ id: 'ext-1', mudando_composicao: false }], [{ mudando_composicao: false }]],
      anuncios_externos_itens: [[]],
    });
    const r = await removerPublicado(
      { admin, ctx: CTX, conexao: CONEXAO },
      { familiaId: 'fam-1', orgId: ORG, canal: CANAL, preservarFamilia: true },
    );
    expect(r.tipo).toBe('preservada');
    expect(puts).toEqual([JSON.stringify({ status: 'paused' })]);
  });

  it('7. Legacy Remover sem ctx/token → erro explícito, não delete local', async () => {
    const { admin, deletes } = cenarioLegacy();
    await expect(removerPublicado({ admin }, { familiaId: 'fam-1', orgId: ORG, canal: CANAL }))
      .rejects.toThrow(/conexão com o Mercado Livre/);
    expect(deletes).toEqual([]);
  });
});
