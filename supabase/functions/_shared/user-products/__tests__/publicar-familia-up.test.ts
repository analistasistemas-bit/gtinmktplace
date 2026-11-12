import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// publicar-familia-up importa queue.ts (enfileirarVinculacaoCatalogo), que puxa npm:@upstash/qstash
// — irresolúvel no vitest. Mock com spy hoisted para asserir o disparo do catálogo (ADR-0088 F2).
const { enfileirarCatalogoSpy } = vi.hoisted(() => ({ enfileirarCatalogoSpy: vi.fn() }));
vi.mock('../../queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarCatalogoSpy }));

// portas-supabase.ts recebe montarPayloadPlano como closure — capturamos aqui pra inspecionar o
// payload de cada SKU sem precisar rodar a saga real (que já é faked via executarSaga).
// `portasFalsas.atual`: portas em memória para rodar o `publicarGrupo` real (testes de kit com variação).
const { criarPortasSpy, portasFalsas } = vi.hoisted(() => ({ criarPortasSpy: vi.fn(), portasFalsas: { atual: null as unknown } }));
vi.mock('../portas-supabase.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../portas-supabase.ts')>();
  return {
    ...real,
    criarPortasSupabase: (deps: unknown) => {
      criarPortasSpy(deps);
      return portasFalsas.atual ? { ...(portasFalsas.atual as object) } : real.criarPortasSupabase(deps as never);
    },
  };
});

import { publicarFamiliaUP } from '../publicar-familia-up';
import type { ResultadoSaga } from '../publicar-grupo';
import { fakeConnector } from '../../canais/fake';
import type { AnuncioCanonico } from '../../canais/contrato';
import type { ChartResolvido } from '../../ml/size-chart';

// Fake admin: registra writes e devolve as linhas filhas (para a escolha do 1º item no 'ativo').
function fakeAdmin(childRows: Record<string, unknown>[]) {
  const writes: Array<{ table: string; op: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  function chain(table: string) {
    const rec = { table, op: '', payload: {} as Record<string, unknown>, filters: {} as Record<string, unknown> };
    const api: Record<string, unknown> = {
      select: () => { rec.op = rec.op || 'select'; return api; },
      upsert: (payload: Record<string, unknown>) => { rec.op = 'upsert'; rec.payload = payload; writes.push({ ...rec }); return api; },
      update: (payload: Record<string, unknown>) => { rec.op = 'update'; rec.payload = payload; return api; },
      eq: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      in: () => api,
      maybeSingle: async () => ({ data: { id: 'root-1', criado_em: '2026-07-22T00:00:00Z' }, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === 'update') writes.push({ ...rec });
        const data = (table === 'anuncios_externos_itens' && rec.op === 'select') ? childRows : null;
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return api;
  }
  return { admin: { from: chain } as never, writes };
}

const FAMILIA = { id: 'fam-1', user_id: 'user-1', org_id: 'org-1', codigo_pai: '03103331', titulo_ml: 'AGULHA CROCHE MATTE', nome_pai: 'AGULHA', descricao_ml: 'Desc', atacado: null };

const ANUNCIO: AnuncioCanonico = {
  titulo: 'AGULHA CROCHE MATTE', descricao: 'Desc', categoriaId: 'MLB419782', atributos: [],
  capaFotoId: 'CAPA', capa2FotoId: null, capa3FotoId: null, listingTypeId: 'gold_special',
  desconto: null, dimensoes: null,
  variacoes: [
    { sku: 's-verde', cor: 'Verde', estoque: 5, preco: 29.9, gtin: null, fotoId: 'F1' },
    { sku: 's-azul', cor: 'Azul', estoque: 3, preco: 29.9, gtin: null, fotoId: 'F2' },
  ],
};

const ctx = { getToken: () => Promise.resolve('tok') };
const conexao = { id: 'conn-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: 'seller-1', expiresAt: null };

function deps(saga: ResultadoSaga, childRows: Record<string, unknown>[] = []) {
  const { admin, writes } = fakeAdmin(childRows);
  return {
    args: {
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: FAMILIA as never, anuncio: ANUNCIO, categoriaId: 'MLB419782',
      executarSaga: () => Promise.resolve(saga),
    },
    writes,
  };
}

describe('publicarFamiliaUP — orquestra raiz + saga + persistência', () => {
  beforeEach(() => {
    fakeConnector.reset();
    enfileirarCatalogoSpy.mockReset().mockResolvedValue('msg-1');
    criarPortasSpy.mockReset();
  });

  it('grava a raiz ANTES da saga: status=publicando, titulo=family_name, skus_esperados = todos', async () => {
    const { args, writes } = deps({ estado: 'compensacao_pendente' });
    await publicarFamiliaUP(args);
    const up = writes.find((w) => w.table === 'anuncios_externos' && w.op === 'upsert')!;
    expect(up.payload.status).toBe('publicando');
    expect(up.payload.titulo).toBe('AGULHA CROCHE MATTE');
    expect(up.payload.particao).toBe(0);
    expect(up.payload.item_externo_id).toBeNull();
    expect(new Set(up.payload.skus_esperados as string[])).toEqual(new Set(['s-verde', 's-azul']));
    // anuncios_externos.user_id é NOT NULL em produção (coluna original, pré-E7) — sem isso o
    // upsert falha em runtime real mesmo passando em mocks que não validam constraints.
    expect(up.payload.user_id).toBe('user-1');
  });

  it('family_name nunca passa de 60 caracteres (limite real do ML) mesmo com título no limite', async () => {
    // Título com exatamente 60 chars (achado real em produção 2026-07-22, PAI 03103331): o
    // ML rejeita family_name > 60 ("Family Name length is over of 60 character").
    const tituloNoLimite = 'AGULHA CROCHÊ CABO PLASTICO MATTE 15CM | CONFORTO E CONTROLE';
    expect(tituloNoLimite.length).toBe(60);
    const familiaLonga = { ...FAMILIA, titulo_ml: tituloNoLimite };
    const { admin, writes } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: familiaLonga as never, anuncio: ANUNCIO, categoriaId: 'MLB419782',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
    });
    const up = writes.find((w) => w.table === 'anuncios_externos' && w.op === 'upsert')!;
    const titulo = up.payload.titulo as string;
    expect(titulo.length).toBeLessThanOrEqual(60);
  });

  it('family_name NÃO carrega sufixo de partição visível ao cliente (achado real 2026-07-22: '
    + 'ML mostra o family_name como título — "[p0]" vazou pro cliente final)', async () => {
    // Este worker (publish-familia-ml) só publica a partição 0 — nunca duas partições da mesma
    // família disputam a mesma UPP aqui (isso só existe no split, publicar-split-ml, que ainda não
    // integra a saga UP). Sufixo de desambiguação é desnecessário e vaza pro título real do cliente.
    const { admin, writes } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: FAMILIA as never, anuncio: ANUNCIO, categoriaId: 'MLB419782',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
    });
    const up = writes.find((w) => w.table === 'anuncios_externos' && w.op === 'upsert')!;
    expect(up.payload.titulo).toBe('AGULHA CROCHE MATTE');
  });

  it('saga ativo → familias publicado com ml_item_id = 1º item (cor alfabética: Azul)', async () => {
    const childRows = [
      { sku: 's-verde', status: 'ativo', retirado: false, item_externo_id: 'MLB-VERDE', permalink: 'https://ml/verde' },
      { sku: 's-azul', status: 'ativo', retirado: false, item_externo_id: 'MLB-AZUL', permalink: 'https://ml/azul' },
    ];
    const { args, writes } = deps({ estado: 'ativo' }, childRows);
    const r = await publicarFamiliaUP(args);
    expect(r.estado).toBe('ativo');
    const famUpd = writes.find((w) => w.table === 'familias' && w.op === 'update')!;
    expect(famUpd.payload.status).toBe('publicado');
    expect(famUpd.payload.ml_item_id).toBe('MLB-AZUL'); // Azul < Verde (alfabético)
    expect(famUpd.payload.ml_permalink).toBe('https://ml/azul');
    // root marcado publicado
    const rootUpd = writes.find((w) => w.table === 'anuncios_externos' && w.op === 'update' && w.payload.status === 'publicado');
    expect(rootUpd).toBeTruthy();
  });

  it('saga ativo → variacoes.ml_variation_id = null em UP (não é sub-recurso variations)', async () => {
    const childRows = [
      { sku: 's-verde', status: 'ativo', retirado: false, item_externo_id: 'MLB-VERDE', permalink: 'p' },
      { sku: 's-azul', status: 'ativo', retirado: false, item_externo_id: 'MLB-AZUL', permalink: 'p' },
    ];
    const { args, writes } = deps({ estado: 'ativo' }, childRows);
    await publicarFamiliaUP(args);
    const varUpd = writes.filter((w) => w.table === 'variacoes' && w.op === 'update');
    expect(varUpd.length).toBeGreaterThan(0);
    expect(varUpd.every((w) => w.payload.ml_variation_id === null)).toBe(true);
  });

  it('saga ativo → enfileira vinculação de catálogo (ADR-0088 F2) com o id da família', async () => {
    const childRows = [
      { sku: 's-verde', status: 'ativo', retirado: false, item_externo_id: 'MLB-VERDE', permalink: 'p' },
      { sku: 's-azul', status: 'ativo', retirado: false, item_externo_id: 'MLB-AZUL', permalink: 'p' },
    ];
    const { args } = deps({ estado: 'ativo' }, childRows);
    await publicarFamiliaUP(args);
    expect(enfileirarCatalogoSpy).toHaveBeenCalledWith('fam-1');
  });

  it('falha ao enfileirar catálogo NÃO derruba o estado ativo (best-effort, igual ao Legacy)', async () => {
    enfileirarCatalogoSpy.mockRejectedValue(new Error('QStash fora do ar'));
    const childRows = [
      { sku: 's-verde', status: 'ativo', retirado: false, item_externo_id: 'MLB-VERDE', permalink: 'p' },
      { sku: 's-azul', status: 'ativo', retirado: false, item_externo_id: 'MLB-AZUL', permalink: 'p' },
    ];
    const { args } = deps({ estado: 'ativo' }, childRows);
    const r = await publicarFamiliaUP(args);
    expect(r.estado).toBe('ativo');
  });

  it('desfecho não-ativo NÃO enfileira catálogo (nada publicado ainda)', async () => {
    const { args } = deps({ estado: 'compensacao_pendente' });
    await publicarFamiliaUP(args);
    expect(enfileirarCatalogoSpy).not.toHaveBeenCalled();
  });

  it('saga compensacao_pendente → familias erro (retomada), NUNCA publicado', async () => {
    const { args, writes } = deps({ estado: 'compensacao_pendente' });
    const r = await publicarFamiliaUP(args);
    expect(r.estado).toBe('compensacao_pendente');
    const famUpd = writes.find((w) => w.table === 'familias' && w.op === 'update')!;
    expect(famUpd.payload.status).toBe('erro');
    expect(String(famUpd.payload.erro_mensagem)).toMatch(/parcial|reenvie/i);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'publicado')).toBe(false);
  });

  it('saga erro/familia_up_desagrupada → familias erro com mensagem específica citando o caso', async () => {
    const { args, writes } = deps({ estado: 'erro', codigo: 'familia_up_desagrupada' });
    const r = await publicarFamiliaUP(args);
    expect(r.estado).toBe('erro');
    const famUpd = writes.find((w) => w.table === 'familias' && w.op === 'update')!;
    expect(famUpd.payload.status).toBe('erro');
    expect(String(famUpd.payload.erro_mensagem)).toMatch(/agrup/i);
  });
});

// ADR-0200 (Task 5): CREATE e ativação de SKU de kit com variação seguram a exclusão do SKU durante a saga e
// publicam o saldo relido sob a exclusão, nunca o do snapshot do job.
describe('publicarFamiliaUP — kit com variação (saga real publicarGrupo)', () => {
  beforeEach(() => { criarPortasSpy.mockReset(); portasFalsas.atual = null; });
  afterEach(() => { portasFalsas.atual = null; });

  type Pol = { codigo: string; estado: string; versao: number; bloqueio_operador: boolean; bloqueio_moderacao: boolean; bloqueio_retirada: boolean };
  const pol = (x: Partial<Pol> = {}): Pol => ({
    codigo: 's-verde', estado: 'normal', versao: 1, bloqueio_operador: false, bloqueio_moderacao: false, bloqueio_retirada: false, ...x,
  });

  interface Cenario {
    adquirir?: Record<string, unknown>;
    /** Política devolvida na leitura n (0 = primeira). */
    politica?: (n: number) => Pol[];
    /** Exclusões que já eram deste dono antes da tentativa (retomada). */
    minhas?: string[];
    /** Filhos que já existem: sku → { item, status no ML }. */
    existentes?: Record<string, { item: string; status: 'active' | 'paused' }>;
    /** Busca por SKU que acha item (adoção). */
    buscaAcha?: Record<string, string>;
    /** Quantidade do UP no ML na confirmação. */
    qtdMl?: number;
    /** Resposta de `kit_saldo_canonico`. */
    saldoCanonico?: Record<string, number>;
  }

  function montar(c: Cenario = {}) {
    const eventos: string[] = [];
    const mlStatus: string[] = [];
    const filhos = new Map<string, { sku: string; status: string; retirado: boolean; itemExternoId: string | null }>();
    const remoto = new Map<string, string>();
    for (const [sku, e] of Object.entries(c.existentes ?? {})) {
      filhos.set(sku, { sku, status: e.status === 'active' ? 'ativo' : 'pausado', retirado: false, itemExternoId: e.item });
      remoto.set(e.item, e.status);
    }
    portasFalsas.atual = {
      listar: async () => [...filhos.values()].map((f) => ({ ...f })),
      reservar: async (_id: string, skus: string[]) => {
        for (const sku of skus) if (!filhos.has(sku)) filhos.set(sku, { sku, status: 'pendente', retirado: false, itemExternoId: null });
      },
      salvarStatus: async (_id: string, sku: string, status: string) => { filhos.get(sku)!.status = status; },
      salvarCriado: async (_id: string, sku: string, item: string) => { Object.assign(filhos.get(sku)!, { status: 'criado', itemExternoId: item }); },
      buscarPorSku: async (sku: string) => (c.buscaAcha?.[sku]
        ? { tipo: 'um', itemExternoId: c.buscaAcha[sku] } : { tipo: 'nenhum' }),
      criarPlano: async (sku: string) => {
        eventos.push(`criar:${sku}`);
        remoto.set(`MLB-${sku}`, 'active');
        return { itemExternoId: `MLB-${sku}`, permalink: `p-${sku}` };
      },
      confirmar: async () => ({ ok: true, familyId: 'F', userProductId: 'UP' }),
      mudarStatus: async (id: string, st: string) => { mlStatus.push(`${id}:${st}`); remoto.set(id, st === 'ativo' ? 'active' : 'paused'); },
      salvarConfirmacao: async () => {},
      salvarEstadoDesejado: async (_id: string, e: string | null) => { eventos.push(`estado:${e}`); },
    };

    const { admin, writes } = fakeAdmin([]);
    let nPol = 0;
    const politica = c.politica ?? (() => [pol()]);
    const itensRows = () => [...filhos.values()].map((f) => ({
      sku: f.sku, item_externo_id: f.itemExternoId, user_product_id: f.itemExternoId ? `UP-${f.sku}` : null, permalink: `p-${f.sku}`,
    }));
    const tabelaItens = () => {
      let skus: string[] | null = null;
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        in: (_c: string, v: string[]) => { skus = v; return q; },
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: itensRows().filter((r) => !skus || skus.includes(r.sku)), error: null }).then(res),
      };
      return q;
    };
    const kitAdmin = {
      from: (t: string) => {
        if (t === 'sku_politica_kit') {
          return { select: () => ({ eq: () => ({ in: async () => { eventos.push('politica'); return { data: politica(nPol++), error: null }; } }) }) };
        }
        if (t === 'kit_exclusoes') {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: (c.minhas ?? []).map((codigo) => ({ codigo })), error: null }) }) }) };
        }
        if (t === 'anuncios_externos_itens') return tabelaItens();
        if (t === 'variacoes') {
          return {
            // Achado 1 da revisão final: a leitura de linhas devolve a cópia antiga (9) ANTES da vigente (1).
            // O saldo só pode vir da RPC da canônica.
            select: () => ({ eq: () => ({ in: () => ({ order: async () => {
              eventos.push('reler');
              return { data: [
                { codigo: 's-verde', estoque: 9, familias: { criado_em: '2026-01-01' } },
                { codigo: 's-verde', estoque: 1, familias: { criado_em: '2026-06-01' } },
              ], error: null };
            } }) }) }),
            update: (v: unknown) => ((admin as { from: (t: string) => { update: (v: unknown) => unknown } }).from(t)).update(v),
          };
        }
        return (admin as { from: (t: string) => unknown }).from(t);
      },
      rpc: async (nome: string, a: Record<string, unknown>) => {
        if (nome === 'kit_skus_participantes') {
          return { data: (a.p_codigos as string[]).filter((x) => x === 's-verde'), error: null };
        }
        if (nome === 'kit_saldo_canonico') {
          eventos.push('reler');
          return { data: c.saldoCanonico ?? { 's-verde': 1 }, error: null };
        }
        eventos.push(nome === 'kit_adquirir_exclusao' ? `adquirir:${a.p_dono_tipo}:${a.p_dono_id}` : `${nome}`);
        return { data: nome === 'kit_adquirir_exclusao' ? (c.adquirir ?? { ok: true }) : null, error: null };
      },
    };
    const lerOfertaFn = async (_t: string, up: string, ids: string[]) => ({
      upId: up, versao: 1, locais: [], somenteSellingAddress: true, quantidade: c.qtdMl ?? 1,
      itens: ids.map((id) => ({ id, status: remoto.get(id) ?? 'unknown', subStatus: [] as string[] })),
    });
    const rodar = (over: Record<string, unknown> = {}) => publicarFamiliaUP({
      admin: kitAdmin as never, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, organizations: { modulos_habilitados: ['kit_variacao'] } } as never,
      anuncio: ANUNCIO, categoriaId: 'MLB419782', lerOfertaFn: lerOfertaFn as never,
      versoesKit: { 's-verde': 1 }, ...over,
    });
    const famStatus = () => writes.filter((w) => w.table === 'familias' && w.op === 'update').map((w) => w.payload.status);
    return { rodar, eventos, mlStatus, famStatus, soltou: () => eventos.includes('kit_soltar_exclusao') };
  }

  it('CREATE novo: exclusão, política, saldo canônico, saga, confirmação e só então solta e publica', async () => {
    const m = montar();
    const r = await m.rodar();
    expect(r.estado).toBe('ativo');
    expect(m.eventos.slice(0, 3)).toEqual(['adquirir:publicacao:root-1', 'politica', 'reler']);
    expect(m.eventos.indexOf('estado:ativando')).toBeGreaterThan(m.eventos.lastIndexOf('criar:s-verde'));
    expect(m.eventos.at(-1)).toBe('kit_soltar_exclusao');
    const montarPayload = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (s: string) => { available_quantity: number } }).montarPayloadPlano;
    expect(montarPayload('s-verde').available_quantity).toBe(1);
    expect(m.famStatus()).toContain('publicado');
  });

  it('SKU de kit sem variação canônica: recusa antes de criar e solta', async () => {
    const m = montar({ saldoCanonico: {} });
    const r = await m.rodar();
    expect(r).toMatchObject({ estado: 'erro', mensagem: expect.stringContaining('sem variação canônica') });
    expect(m.eventos.some((e) => e.startsWith('criar:'))).toBe(false);
    expect(m.soltou()).toBe(true);
  });

  it('Reenviar com item já existente (não é retomada): recusa, nada ativa nem cria, solta e marca erro', async () => {
    const m = montar({ existentes: { 's-verde': { item: 'MLB-V', status: 'paused' } } });
    const r = await m.rodar();
    expect(r).toMatchObject({ estado: 'erro', mensagem: expect.stringContaining('Gerenciar kit') });
    expect(m.mlStatus).toEqual([]);
    expect(m.eventos.some((e) => e.startsWith('criar:'))).toBe(false);
    expect(m.soltou()).toBe(true);
    expect(m.famStatus()).toEqual(['erro']);
  });

  it('busca que adotaria item do SKU de kit: recusa sem ativar', async () => {
    const m = montar({ buscaAcha: { 's-verde': 'MLB-ORFAO' } });
    const r = await m.rodar();
    expect(r).toMatchObject({ estado: 'erro', mensagem: expect.stringContaining('Gerenciar kit') });
    expect(m.mlStatus.filter((x) => x.endsWith(':ativo'))).toEqual([]);
    expect(m.soltou()).toBe(true);
  });

  it('retomada da própria publicação (exclusão já deste dono): ativa, confirma e solta', async () => {
    const m = montar({ minhas: ['s-verde'], existentes: { 's-verde': { item: 'MLB-V', status: 'paused' } } });
    const r = await m.rodar();
    expect(r.estado).toBe('ativo');
    expect(m.mlStatus).toContain('MLB-V:ativo');
    expect(m.soltou()).toBe(true);
  });

  it('política vira Guardado antes de ativar: erro (nunca compensacao_pendente), nada ativo, exclusão mantida', async () => {
    // Leituras: inicial, criarPlano de s-azul e s-verde, e a de antes de ativar.
    const m = montar({ politica: (n) => [n >= 3 ? pol({ estado: 'guardado' }) : pol()] });
    const r = await m.rodar();
    expect(r).toMatchObject({ estado: 'erro', mensagem: expect.stringContaining('Vender só em kit') });
    expect(m.mlStatus.filter((x) => x.endsWith(':ativo'))).toEqual([]);
    expect(m.eventos).not.toContain('estado:ativando');
    expect(m.soltou()).toBe(false);   // o item do kit já foi criado (pausado)
    expect(m.famStatus()).toEqual(['erro']);
  });

  it('versão da política diferente da capturada ao enfileirar: recusa antes de criar e solta', async () => {
    const m = montar({ politica: () => [pol({ versao: 2 })] });
    const r = await m.rodar();
    expect(r).toMatchObject({ estado: 'erro', mensagem: expect.stringContaining('Publique de novo') });
    expect(m.eventos.some((e) => e.startsWith('criar:'))).toBe(false);
    expect(m.soltou()).toBe(true);
  });

  it('job sem a versão capturada: recusa sem adquirir a exclusão', async () => {
    const m = montar();
    const r = await m.rodar({ versoesKit: undefined });
    expect(r.estado).toBe('erro');
    expect(m.eventos).toEqual([]);
  });

  it('ativo sem confirmação (ML acima do saldo): não publica, pausa o item do kit, mantém a exclusão', async () => {
    const m = montar({ qtdMl: 5 });
    const r = await m.rodar();
    expect(r).toMatchObject({ estado: 'erro', mensagem: expect.stringContaining('Reenviar') });
    expect(m.famStatus()).not.toContain('publicado');
    expect(m.famStatus()).toContain('erro');
    expect(m.mlStatus.at(-1)).toBe('MLB-s-verde:pausado');
    expect(m.soltou()).toBe(false);
  });

  it('SKU ocupado por transferência: lança para a fila repetir, sem criar nada', async () => {
    const m = montar({ adquirir: { ok: false, codigo: 's-verde' } });
    await expect(m.rodar()).rejects.toThrow(/s-verde/);
    expect(m.eventos.some((e) => e.startsWith('criar:'))).toBe(false);
  });

  it('org sem o módulo: nenhuma exclusão, nenhuma leitura nova, snapshot como hoje', async () => {
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, organizations: { modulos_habilitados: [] } } as never, anuncio: ANUNCIO, categoriaId: 'MLB419782',
      executarSaga: async () => ({ estado: 'compensacao_pendente' }),
    });
    const montarPayload = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (s: string) => { available_quantity: number } }).montarPayloadPlano;
    expect(montarPayload('s-verde').available_quantity).toBe(5);
  });
});

// ADR-0167: família com tamanho precisa resolver o guia de medidas ANTES de montar o payload de
// cada SKU, e gênero é obrigatório junto (Decisão 6). Sem tamanho em nenhuma variação (toda org
// sem tipo de produto habilitado, INV-1), nada disto é acionado — coberto pelos testes acima, que
// não setam `familia.genero` nem `variacoes[].tamanho` e continuam passando inalterados.
// ADR-0196: o PxQ é por ITEM e o valor é absoluto. Com a base de outra cor, a mais barata ficaria
// com faixa igual ou acima do próprio preço.
describe('publicarFamiliaUP — atacado sobre o preço de cada item', () => {
  const FAIXAS = [{ min_unidades: 3, desconto_pct: 8 }];
  const FILHOS = [
    { sku: 's-verde', item_externo_id: 'MLB1', permalink: null },
    { sku: 's-azul', item_externo_id: 'MLB2', permalink: null },
  ];
  const cores = (verde: number | null, azul: number | null) => ({
    ...ANUNCIO, variacoes: [{ ...ANUNCIO.variacoes[0], preco: verde }, { ...ANUNCIO.variacoes[1], preco: azul }],
  }) as AnuncioCanonico;
  async function publicar(anuncio: AnuncioCanonico, filhos: Record<string, unknown>[] = FILHOS, falhar = false) {
    const aplicados: [string, number, unknown][] = [];
    const conn = {
      ...fakeConnector, capabilities: { ...fakeConnector.capabilities, atacado: true, descricaoSeparada: false },
      aplicarAtacado: async (_c: unknown, id: string, base: number, f: unknown) => {
        if (falhar) throw new Error('ML 500');
        aplicados.push([id, base, f]);
      },
    };
    const { admin, writes } = fakeAdmin(filhos);
    await publicarFamiliaUP({
      admin, conn: conn as never, ctx, conexao, familia: { ...FAMILIA, atacado: FAIXAS } as never, anuncio, categoriaId: 'MLB419782',
      executarSaga: () => Promise.resolve({ estado: 'ativo', itemExternoId: 'MLB1', permalink: null } as never),
    });
    return { aplicados, atacado: writes.filter((w) => w.table === 'familias' && 'atacado_status' in w.payload).map((w) => w.payload) };
  }

  beforeEach(() => { fakeConnector.reset(); enfileirarCatalogoSpy.mockReset().mockResolvedValue('msg-1'); });

  it('cores com preços diferentes: cada item recebe as faixas sobre o próprio preço', async () => {
    const r = await publicar(cores(10, 25));
    expect(r.aplicados).toEqual([['MLB1', 10, FAIXAS], ['MLB2', 25, FAIXAS]]);
    expect(r.atacado).toEqual([{ atacado_status: 'aplicado', atacado_erro: null }]);
  });

  it('item sem preço: não aplica em nenhum e grava erro', async () => {
    const r = await publicar(cores(10, null));
    expect(r.aplicados).toEqual([]);
    expect(r.atacado).toMatchObject([{ atacado_status: 'erro' }]);
    expect(String(r.atacado[0].atacado_erro)).toMatch(/preço-base/);
  });

  it('filho antigo fora desta publicação não recebe faixas nem vira erro', async () => {
    const r = await publicar(cores(10, 25), [...FILHOS, { sku: 's-velho', item_externo_id: 'MLB9', permalink: null }]);
    expect(r.aplicados.map(([id]) => id)).toEqual(['MLB1', 'MLB2']);
    expect(r.atacado).toEqual([{ atacado_status: 'aplicado', atacado_erro: null }]);
  });

  it('faixa arredondada igual ao base: não envia e grava erro', async () => {
    const aplicados: unknown[] = [];
    const conn = {
      ...fakeConnector, capabilities: { ...fakeConnector.capabilities, atacado: true, descricaoSeparada: false },
      aplicarAtacado: async (...a: unknown[]) => { aplicados.push(a); },
    };
    const { admin, writes } = fakeAdmin(FILHOS);
    await publicarFamiliaUP({
      admin, conn: conn as never, ctx, conexao, categoriaId: 'MLB419782', anuncio: cores(1, 50),
      familia: { ...FAMILIA, atacado: [{ min_unidades: 3, desconto_pct: 0.1 }] } as never,
      executarSaga: () => Promise.resolve({ estado: 'ativo', itemExternoId: 'MLB1', permalink: null } as never),
    });
    expect(aplicados).toEqual([]);
    const erro = writes.find((w) => w.table === 'familias' && w.payload.atacado_status === 'erro');
    expect(String(erro?.payload.atacado_erro)).toMatch(/igual ou acima/);
  });

  it('falha ao aplicar grava erro', async () => {
    expect((await publicar(cores(10, 25), FILHOS, true)).atacado).toMatchObject([{ atacado_status: 'erro' }]);
  });
});

describe('publicarFamiliaUP — guia de tamanhos (ADR-0167)', () => {
  beforeEach(() => {
    fakeConnector.reset();
    enfileirarCatalogoSpy.mockReset().mockResolvedValue('msg-1');
    criarPortasSpy.mockReset();
  });

  const CHART: ChartResolvido = {
    chartId: '8522331',
    linhaPorTamanho: new Map([
      ['P', { rowId: '8522331:1', sizeLabel: 'P' }],
      ['M', { rowId: '8522331:2', sizeLabel: 'M' }],
    ]),
  };
  const garantirChartFn = vi.fn().mockResolvedValue(CHART);

  const ANUNCIO_COM_TAMANHO: AnuncioCanonico = {
    ...ANUNCIO,
    variacoes: [
      { sku: 's-azul-p', cor: 'Azul', estoque: 5, preco: 599.9, gtin: null, fotoId: 'F1', tamanho: 'P' },
      { sku: 's-azul-m', cor: 'Azul', estoque: 3, preco: 599.9, gtin: null, fotoId: 'F2', tamanho: 'M' },
    ],
  };

  it('resolve o chart UMA vez por família, com os tamanhos únicos das variações', async () => {
    garantirChartFn.mockClear();
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'masculino' } as never,
      anuncio: ANUNCIO_COM_TAMANHO, categoriaId: 'MLB108803',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn,
    });
    expect(garantirChartFn).toHaveBeenCalledTimes(1);
    expect(garantirChartFn).toHaveBeenCalledWith(
      admin, 'tok', 'conn-1', 'MLB108803', 'masculino', ['P', 'M'], 'letras',
    );
  });

  // ADR-0182 D2: a grade gravada vence; sem ela só Letras/Calçado são inferíveis.
  it('passa a grade gravada (calca) ao garantirChart', async () => {
    const fn = vi.fn().mockResolvedValue({ chartId: '1', linhaPorTamanho: new Map([['40', { rowId: '1:1', sizeLabel: '40' }]]) });
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'masculino', grade_tamanho: 'calca' } as never,
      anuncio: { ...ANUNCIO, variacoes: [{ sku: 's-40', cor: 'Azul', estoque: 1, preco: 99, gtin: null, fotoId: 'F1', tamanho: '40' }] },
      categoriaId: 'MLB188065',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn: fn,
    });
    expect(fn).toHaveBeenCalledWith(admin, 'tok', 'conn-1', 'MLB188065', 'masculino', ['40'], 'calca');
  });

  // ADR-0182 D7: CLOTHING_LOTS (sem guia) → GENDER infantil + CLOTHING_LOT_SIZE próprio do SKU,
  // mesmo que atributos_ml (IA/Revisão) já traga um CLOTHING_LOT_SIZE de nível família.
  it('sem guia (CLOTHING_LOTS), gênero meninos → GENDER 339667 + exatamente um CLOTHING_LOT_SIZE', async () => {
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'meninos', grade_tamanho: 'infantil' } as never,
      anuncio: {
        ...ANUNCIO, atributos: [{ id: 'CLOTHING_LOT_SIZE', value_name: '2' }],
        variacoes: [
          { sku: 's-4', cor: 'Azul', estoque: 1, preco: 99, gtin: null, fotoId: 'F1', tamanho: '4' },
          { sku: 's-6', cor: 'Azul', estoque: 1, preco: 99, gtin: null, fotoId: 'F2', tamanho: '6' },
        ],
      },
      categoriaId: 'MLB271219',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn: vi.fn().mockResolvedValue({ semGuia: 'CLOTHING_LOT_SIZE' }),
    });
    const montarPayloadPlano = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_id?: string; value_name?: string }[] } }).montarPayloadPlano;
    const p6 = montarPayloadPlano('s-6');
    expect(p6.attributes.filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339667' }]);
    expect(p6.attributes.filter((a) => a.id === 'CLOTHING_LOT_SIZE')).toEqual([{ id: 'CLOTHING_LOT_SIZE', value_name: '6' }]);
    expect(p6.attributes.map((a) => a.id)).not.toContain('SIZE');
  });

  // Emenda ADR-0182 (2026-10-17): SWIMWEAR (Moda Praia) sem guia → GENDER da família + SIZE cru
  // do próprio SKU; SIZE de nível família (IA/Revisão) nunca vaza.
  it('sem guia (SWIMWEAR), gênero meninas → GENDER 339668 + exatamente um SIZE cru, sem grid', async () => {
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'meninas', grade_tamanho: 'infantil' } as never,
      anuncio: {
        ...ANUNCIO, atributos: [{ id: 'SIZE', value_name: '2' }],
        variacoes: [
          { sku: 's-4', cor: 'Rosa', estoque: 1, preco: 99, gtin: null, fotoId: 'F1', tamanho: '4' },
          { sku: 's-6', cor: 'Rosa', estoque: 1, preco: 99, gtin: null, fotoId: 'F2', tamanho: '6' },
        ],
      },
      categoriaId: 'MLB430391',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn: vi.fn().mockResolvedValue({ semGuia: 'SIZE' }),
    });
    const montarPayloadPlano = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_id?: string; value_name?: string }[] } }).montarPayloadPlano;
    const p6 = montarPayloadPlano('s-6');
    expect(p6.attributes.filter((a) => a.id === 'GENDER')).toEqual([{ id: 'GENDER', value_id: '339668' }]);
    expect(p6.attributes.filter((a) => a.id === 'SIZE')).toEqual([{ id: 'SIZE', value_name: '6' }]);
    const ids = p6.attributes.map((a) => a.id);
    expect(ids).not.toContain('SIZE_GRID_ID');
    expect(ids).not.toContain('CLOTHING_LOT_SIZE');
  });

  it('grade não resolvível (sem grade_tamanho, tamanho infantil) lança ANTES do chart', async () => {
    const fn = vi.fn();
    const { admin } = fakeAdmin([]);
    await expect(publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'meninos', grade_tamanho: null } as never,
      anuncio: { ...ANUNCIO, variacoes: [{ sku: 's-4', cor: 'Azul', estoque: 1, preco: 99, gtin: null, fotoId: 'F1', tamanho: '4' }] },
      categoriaId: 'MLB188064',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn: fn,
    })).rejects.toThrow(/grade de tamanho/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cada SKU recebe tamanho + sizeGridId + sizeGridRowId da sua própria linha do chart', async () => {
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'masculino' } as never,
      anuncio: ANUNCIO_COM_TAMANHO, categoriaId: 'MLB108803',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn,
    });
    const montarPayloadPlano = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_name?: string }[] } }).montarPayloadPlano;
    const payloadP = montarPayloadPlano('s-azul-p');
    expect(payloadP.attributes).toEqual(expect.arrayContaining([
      { id: 'SIZE', value_name: 'P' },
      { id: 'SIZE_GRID_ID', value_name: '8522331' },
      { id: 'SIZE_GRID_ROW_ID', value_name: '8522331:1' },
    ]));
    const payloadM = montarPayloadPlano('s-azul-m');
    expect(payloadM.attributes).toEqual(expect.arrayContaining([
      { id: 'SIZE', value_name: 'M' },
      { id: 'SIZE_GRID_ROW_ID', value_name: '8522331:2' },
    ]));
  });

  // Achado real de produção (2026-09-19, sandália): /items/validate recusou SIZE="37"
  // (invalid.fashion_grid.size.values), só aceitou "37 BR" — o rótulo da linha, não
  // `variacoes.tamanho` cru. Em calçado os dois DIVERGEM (ao contrário de P=P em vestuário).
  it('calçado: SIZE usa o sizeLabel da linha do chart, não o tamanho cru (achado real)', async () => {
    const chartCalcado: ChartResolvido = {
      chartId: '8078230',
      linhaPorTamanho: new Map([['37', { rowId: '8078230:5', sizeLabel: '37 BR' }]]),
    };
    const garantirChartCalcado = vi.fn().mockResolvedValue(chartCalcado);
    const anuncioCalcado: AnuncioCanonico = {
      ...ANUNCIO,
      variacoes: [{ sku: 's-preto-37', cor: 'Preto', estoque: 5, preco: 549.9, gtin: null, fotoId: 'F1', tamanho: '37' }],
    };
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'unissex' } as never,
      anuncio: anuncioCalcado, categoriaId: 'MLB273770',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn: garantirChartCalcado,
    });
    const montarPayloadPlano = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_name?: string }[] } }).montarPayloadPlano;
    const payload = montarPayloadPlano('s-preto-37');
    expect(payload.attributes).toEqual(expect.arrayContaining([{ id: 'SIZE', value_name: '37 BR' }]));
    expect(payload.attributes).not.toEqual(expect.arrayContaining([{ id: 'SIZE', value_name: '37' }]));
  });

  it('GENDER entra em atributos_ml quando há tamanho', async () => {
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'feminino' } as never,
      anuncio: ANUNCIO_COM_TAMANHO, categoriaId: 'MLB108803',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn,
    });
    const montarPayloadPlano = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_id?: string }[] } }).montarPayloadPlano;
    const payload = montarPayloadPlano('s-azul-p');
    expect(payload.attributes).toEqual(expect.arrayContaining([{ id: 'GENDER', value_id: '339665' }]));
  });

  it('família com tamanho mas SEM genero falha LOUD (ADR-0167 Decisão 6) — nunca publica sem gênero', async () => {
    const { admin } = fakeAdmin([]);
    await expect(publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: null } as never,
      anuncio: ANUNCIO_COM_TAMANHO, categoriaId: 'MLB108803',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn,
    })).rejects.toThrow(/genero ausente/i);
  });

  // Achado do checkpoint Fable: GENDER é `required` no schema da categoria — a IA/operador na
  // Revisão pode já ter preenchido `atributos_ml` com um GENDER (às vezes errado, ex. a IA
  // classificou sozinha) ANTES desta família ganhar tamanho. Sem dedupe, o payload sai com dois
  // atributos GENDER — o ML aceita o payload mas o comportamento de "qual vale" não é garantido.
  it('GENDER pré-existente em atributos_ml (da IA/Revisão) é substituído, nunca duplicado', async () => {
    const { admin } = fakeAdmin([]);
    const anuncioComGenderErrado: AnuncioCanonico = {
      ...ANUNCIO_COM_TAMANHO,
      atributos: [{ id: 'GENDER', value_id: '339666' }, { id: 'BRAND', value_name: 'Daludi' }],
    };
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: { ...FAMILIA, genero: 'feminino' } as never,
      anuncio: anuncioComGenderErrado, categoriaId: 'MLB108803',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn,
    });
    const montarPayloadPlano = (criarPortasSpy.mock.calls[0][0] as { montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_id?: string; value_name?: string }[] } }).montarPayloadPlano;
    const payload = montarPayloadPlano('s-azul-p');
    const genders = payload.attributes.filter((a) => a.id === 'GENDER');
    expect(genders).toEqual([{ id: 'GENDER', value_id: '339665' }]); // feminino, não o 339666 antigo
    expect(payload.attributes).toEqual(expect.arrayContaining([{ id: 'BRAND', value_name: 'Daludi' }]));
  });

  it('sem tamanho em nenhuma variação: garantirChartFn nunca é chamado (INV-1)', async () => {
    garantirChartFn.mockClear();
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: FAMILIA as never, anuncio: ANUNCIO, categoriaId: 'MLB419782',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      garantirChartFn,
    });
    expect(garantirChartFn).not.toHaveBeenCalled();
  });
});

// Incidente 2026-09-20 (grade de jaqueta, MLB108803): COLOR ia sem `value_id`, então o ML
// reescrevia o nome do cadastro pela grafia do dicionário e deixava fora dos filtros de busca a
// cor que não existe na categoria. O dicionário é lido uma vez por família.
describe('publicarFamiliaUP — COLOR com value_id do dicionário da categoria', () => {
  beforeEach(() => {
    fakeConnector.reset();
    enfileirarCatalogoSpy.mockReset().mockResolvedValue('msg-1');
    criarPortasSpy.mockReset();
  });

  const SCHEMA_COM_CORES = [{
    id: 'COLOR',
    nome: 'Cor',
    required: true,
    conditionalRequired: false,
    valueType: 'string' as const,
    valores: [{ id: '283161', nome: 'Azul-marinho' }, { id: '52049', nome: 'Preto' }],
    allowedUnits: [],
    tags: ['allow_variations'],
  }];

  const ANUNCIO_CORES: AnuncioCanonico = {
    ...ANUNCIO,
    variacoes: [
      { sku: 's-marinho', cor: 'Azul Marinho', estoque: 1, preco: 44.85, gtin: null, fotoId: 'F1' },
      { sku: 's-royal', cor: 'Azul Royal', estoque: 1, preco: 44.85, gtin: null, fotoId: 'F2' },
    ],
  };

  const publicar = async (lerSchemaAtributosFn: unknown) => {
    const { admin } = fakeAdmin([]);
    await publicarFamiliaUP({
      admin, conn: fakeConnector as never, ctx, conexao,
      familia: FAMILIA as never,
      anuncio: ANUNCIO_CORES, categoriaId: 'MLB108803',
      executarSaga: () => Promise.resolve({ estado: 'compensacao_pendente' }),
      lerSchemaAtributosFn: lerSchemaAtributosFn as never,
    });
    return (criarPortasSpy.mock.calls[0][0] as {
      montarPayloadPlano: (sku: string) => { attributes: { id?: string; value_id?: string; value_name?: string }[] };
    }).montarPayloadPlano;
  };
  const cor = (p: { attributes: { id?: string }[] }) => p.attributes.find((a) => a.id === 'COLOR');

  it('cor do dicionário sai com value_id E o nome do cadastro; cor de fora sai só com o nome', async () => {
    const lerSchema = vi.fn().mockResolvedValue(SCHEMA_COM_CORES);
    const montar = await publicar(lerSchema);
    expect(cor(montar('s-marinho'))).toEqual({ id: 'COLOR', value_id: '283161', value_name: 'Azul Marinho' });
    expect(cor(montar('s-royal'))).toEqual({ id: 'COLOR', value_name: 'Azul Royal' });
    // Uma leitura por família, não por SKU.
    expect(lerSchema).toHaveBeenCalledTimes(1);
    expect(lerSchema).toHaveBeenCalledWith('tok', 'MLB108803');
  });

  it('schema indisponível (rede/4xx → []) publica como antes, só com o nome', async () => {
    const montar = await publicar(vi.fn().mockResolvedValue([]));
    expect(cor(montar('s-marinho'))).toEqual({ id: 'COLOR', value_name: 'Azul Marinho' });
  });

  // Revisão Fable: `lerSchemaAtributos` trata 4xx, mas o fetch cru propaga DNS/timeout/reset.
  // Deixar estourar abortaria a publicação com a raiz já em `publicando`.
  it('schema que LANÇA (DNS/timeout) não derruba a publicação — publica só com o nome', async () => {
    const montar = await publicar(vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    expect(cor(montar('s-marinho'))).toEqual({ id: 'COLOR', value_name: 'Azul Marinho' });
    expect(cor(montar('s-royal'))).toEqual({ id: 'COLOR', value_name: 'Azul Royal' });
  });
});

// ADR-0204: o payload plano por SKU leva `anuncio.galeriaFotoIds` (só preenchido pelo publish-familia-ml para kit
// vinculado). Sem ele — inclusive o kit com variação, cujo canônico nunca tem galeria — o payload não muda.
describe('prepararPayloadUP — galeria do kit vinculado (ADR-0204)', () => {
  const anuncio: AnuncioCanonico = {
    titulo: 'Kit 2 Linhas', descricao: 'd', categoriaId: 'MLB1', atributos: [],
    capaFotoId: 'CAPA', capa2FotoId: null, capa3FotoId: null, dimensoes: null,
    variacoes: [{ sku: 'K1', cor: 'Azul', estoque: 3, preco: 20, gtin: null, fotoId: null }],
  };
  const preparar = async (a: AnuncioCanonico) => {
    const { prepararPayloadUP } = await import('../publicar-familia-up');
    const { montar } = await prepararPayloadUP({
      admin: {} as never, ctx: { getToken: async () => 't' }, conexao: { id: 'c1' } as never,
      familia: { id: 'f', titulo_ml: 'Kit 2 Linhas', nome_pai: null, codigo_pai: 'K' } as never,
      anuncio: a, categoriaId: 'MLB1', lerSchemaAtributosFn: async () => [],
    });
    return montar(a.variacoes[0]);
  };
  it('sem galeriaFotoIds → payload de sempre', async () => {
    expect(JSON.stringify(await preparar(anuncio))).toMatchInlineSnapshot(`"{"category_id":"MLB1","currency_id":"BRL","buying_mode":"buy_it_now","listing_type_id":"gold_special","condition":"new","pictures":[{"id":"CAPA"}],"attributes":[{"id":"COLOR","value_name":"Azul"}],"price":20,"available_quantity":3,"seller_custom_field":"K1","family_name":"Kit 2 Linhas"}"`);
  });
  it('com galeriaFotoIds → ids ao fim de pictures, sem repetir a capa', async () => {
    const p = await preparar({ ...anuncio, galeriaFotoIds: ['G1', 'CAPA', 'G2'] });
    expect(p.pictures).toEqual([{ id: 'CAPA' }, { id: 'G1' }, { id: 'G2' }]);
  });
});
