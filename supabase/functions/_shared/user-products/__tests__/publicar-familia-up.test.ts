import { describe, it, expect, beforeEach, vi } from 'vitest';

// publicar-familia-up importa queue.ts (enfileirarVinculacaoCatalogo), que puxa npm:@upstash/qstash
// — irresolúvel no vitest. Mock com spy hoisted para asserir o disparo do catálogo (ADR-0088 F2).
const { enfileirarCatalogoSpy } = vi.hoisted(() => ({ enfileirarCatalogoSpy: vi.fn() }));
vi.mock('../../queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarCatalogoSpy }));

import { publicarFamiliaUP } from '../publicar-familia-up';
import type { ResultadoSaga } from '../publicar-grupo';
import { fakeConnector } from '../../canais/fake';
import type { AnuncioCanonico } from '../../canais/contrato';

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
  beforeEach(() => { fakeConnector.reset(); enfileirarCatalogoSpy.mockReset().mockResolvedValue('msg-1'); });

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
