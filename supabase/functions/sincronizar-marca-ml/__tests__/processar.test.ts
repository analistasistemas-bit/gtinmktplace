import { describe, it, expect } from 'vitest';
import { processarSincronizacaoMarca, type DepsMarca, type ItemLido } from '../processar';
import type { MarcaOrg } from '../../_shared/categoria/marca-org';

const JOB = { org_id: 'org-z', codigo_pai: '00000064' };
const ZAVEN: MarcaOrg = { marcaPadrao: 'Zaven', marcaPropria: true };

function item(brand: { value_name: string; value_id?: string | null } | null, over: Partial<ItemLido> = {}): ItemLido {
  return {
    status: 'paused', familyId: 'FAM-1',
    attrs: brand ? [{ id: 'BRAND', ...brand }, { id: 'COLOR', value_name: 'Azul' }] : [{ id: 'COLOR', value_name: 'Azul' }],
    ...over,
  };
}

/** ML em memória: cada PUT grava os atributos; `aposPut` permite simular efeito colateral. */
function fake(itens: Record<string, ItemLido>, org: MarcaOrg = ZAVEN, opts: {
  aposPut?: (id: string, atual: ItemLido) => ItemLido;
  falhaPut?: (id: string) => Error | null;
  falhaLeitura?: boolean;
} = {}) {
  const puts: Array<{ itemId: string; attrs: Array<{ id: string; value_name: string }> }> = [];
  let leituras = 0;
  const familyIdsGravados: Array<{ familyId: string; itemIds: string[] }> = [];
  const deps: DepsMarca = {
    lerMarcaOrg: async () => org,
    portas: {
      listarFilhos: async () => Object.keys(itens).map((id, i) => ({ sku: `SKU${i + 1}`, itemId: id })),
      lerItem: async (id) => {
        leituras++;
        if (opts.falhaLeitura) throw Object.assign(new Error('rede'), { status: 503 });
        return structuredClone(itens[id]);
      },
      gravarFamilyIdLocal: async (_orgId, itemIds, familyId) => { familyIdsGravados.push({ familyId, itemIds }); },
      putAtributos: async (id, attrs) => {
        const erro = opts.falhaPut?.(id);
        if (erro) throw erro;
        puts.push({ itemId: id, attrs });
        const atual = itens[id];
        const resto = atual.attrs.filter((a) => !attrs.some((n) => n.id === a.id));
        itens[id] = { ...atual, attrs: [...resto, ...attrs] };
        if (opts.aposPut) itens[id] = opts.aposPut(id, itens[id]);
      },
    },
  };
  return { deps, puts, familyIdsGravados, leituras: () => leituras };
}

describe('processarSincronizacaoMarca (ADR-0186)', () => {
  it('org sem marca própria → 400 e nada é lido do ML', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, { marcaPadrao: 'Avil', marcaPropria: false });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.status).toBe(400);
    expect(f.leituras()).toBe(0);
  });

  it('família sem filhos → 400', async () => {
    const f = fake({});
    expect((await processarSincronizacaoMarca(f.deps, JOB)).status).toBe(400);
  });

  it('corrige todos os SKUs com o fornecedor, um PUT só de BRAND por SKU', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }), C: item({ value_name: 'FEIRA' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.status).toBe(200);
    expect(f.puts).toEqual(['A', 'B', 'C'].map((itemId) => ({ itemId, attrs: [{ id: 'BRAND', value_name: 'Zaven' }] })));
    expect(r.body).toEqual({ dryRun: false, corrigidos: ['SKU1', 'SKU2', 'SKU3'], jaCertos: [], familyId: 'FAM-1' });
  });

  it('retry depois de falha parcial: pula o SKU já certo e corrige o que faltou', async () => {
    const f = fake({ A: item({ value_name: 'Zaven' }), B: item({ value_name: 'FEIRA' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts.map((p) => p.itemId)).toEqual(['B']);
    expect(r.body).toMatchObject({ corrigidos: ['SKU2'], jaCertos: ['SKU1'] });
  });

  it('BRAND com value_id de outra marca é divergente; com o nome da org e value_id do ML é certo', async () => {
    const f = fake({ A: item({ value_name: 'Zaven Store', value_id: '123' }), B: item({ value_name: 'ZAVEN', value_id: '777' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts.map((p) => p.itemId)).toEqual(['A']);
    expect(r.body).toMatchObject({ corrigidos: ['SKU1'], jaCertos: ['SKU2'] });
  });

  it('MANUFACTURER presente com o fornecedor vai junto no PUT', async () => {
    const f = fake({ A: { ...item({ value_name: 'FEIRA' }), attrs: [{ id: 'BRAND', value_name: 'FEIRA' }, { id: 'MANUFACTURER', value_name: 'FEIRA' }] } });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts[0].attrs).toEqual([{ id: 'BRAND', value_name: 'Zaven' }, { id: 'MANUFACTURER', value_name: 'Zaven' }]);
  });

  it('status mudou depois do PUT (paused → active) → para', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, ZAVEN, {
      aposPut: (_id, atual) => ({ ...atual, status: 'active' }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(1);
    expect(r.body).toMatchObject({ parouEm: { sku: 'SKU1' } });
  });

  it('family_id null na releitura → para', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, ZAVEN, {
      aposPut: (_id, atual) => ({ ...atual, familyId: null }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(1);
    expect(r.body).toMatchObject({ parouEm: { sku: 'SKU1' } });
  });

  it('family_id divergente entre os SKUs antes → nenhum PUT', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }, { familyId: 'FAM-9' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(0);
    expect(r.body).toMatchObject({ parouEm: { motivo: expect.stringContaining('family_id') } });
  });

  it('family_id ausente em algum SKU antes → nenhum PUT', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }, { familyId: null }) });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(0);
  });

  it('ML recusa o PUT → para com a mensagem do ML, 200 (não retenta sozinho)', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, ZAVEN, {
      falhaPut: () => Object.assign(new Error('item paused não pode ser editado'), { status: 400 }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ parouEm: { sku: 'SKU1', motivo: expect.stringContaining('paused') } });
  });

  it('erro de leitura antes de qualquer PUT → 500 (QStash retenta)', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, ZAVEN, { falhaLeitura: true });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.status).toBe(500);
    expect(f.puts).toHaveLength(0);
  });

  it('dry_run → nenhum PUT, lista o que corrigiria', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'Zaven' }) });
    const r = await processarSincronizacaoMarca(f.deps, { ...JOB, dry_run: true });
    expect(f.puts).toHaveLength(0);
    expect(r.body).toEqual({ dryRun: true, corrigidos: ['SKU1'], jaCertos: ['SKU2'], familyId: 'FAM-1' });
    expect(f.familyIdsGravados).toEqual([]);
  });

  // Medido em produção (00000064, 18/10): trocar BRAND faz o ML reagrupar a família UP INTEIRA num
  // family_id novo, minutos depois do PUT (a releitura imediata ainda mostra o antigo). O vínculo
  // local precisa acompanhar, senão a próxima cor nova acusa "família desagrupada".
  it('SKUs unificados num family_id → grava esse family_id no vínculo local (rodada de convergência)', async () => {
    const f = fake({ A: item({ value_name: 'Zaven' }, { familyId: 'FAM-NOVA' }), B: item({ value_name: 'Zaven' }, { familyId: 'FAM-NOVA' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    // Só os vínculos efetivamente lidos — SKU criado depois da leitura não herda um id não conferido.
    expect(f.familyIdsGravados).toEqual([{ familyId: 'FAM-NOVA', itemIds: ['A', 'B'] }]);
    expect(r.body).toMatchObject({ jaCertos: ['SKU1', 'SKU2'], familyId: 'FAM-NOVA' });
  });

  it('family_id divergente entre SKUs → não grava nada no vínculo local', async () => {
    const f = fake({ A: item({ value_name: 'Zaven' }, { familyId: 'FAM-NOVA' }), B: item({ value_name: 'Zaven' }) });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.familyIdsGravados).toEqual([]);
  });

  // Medido no 00000043 (18/10, 20 SKUs): o ML reagrupa os SKUs já corrigidos num family_id novo
  // ~15 s depois — DURANTE a rodada. A divisão é a transição esperada: 1 família antiga (fornecedor)
  // e 1 nova (marca da org). Qualquer terceira família, ou id ausente, continua parando tudo.
  it('reagrupamento durante a rodada: SKU corrigido que aparece numa família nova não para a rodada', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }), C: item({ value_name: 'FEIRA' }) }, ZAVEN, {
      aposPut: (_id, atual) => ({ ...atual, familyId: 'FAM-NOVA' }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts.map((p) => p.itemId)).toEqual(['A', 'B', 'C']);
    expect(r.body).toMatchObject({ corrigidos: ['SKU1', 'SKU2', 'SKU3'] });
    expect(r.body).not.toHaveProperty('parouEm');
  });

  it('segunda família nova diferente da primeira → para', async () => {
    let n = 0;
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }), C: item({ value_name: 'FEIRA' }) }, ZAVEN, {
      aposPut: (_id, atual) => ({ ...atual, familyId: `FAM-NOVA-${++n}` }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(2);
    expect(r.body).toMatchObject({ parouEm: { sku: 'SKU2' } });
  });

  it('retomada com a família dividida pela marca (certos na nova, pendentes na antiga) → corrige os pendentes', async () => {
    const f = fake({
      A: item({ value_name: 'Zaven' }, { familyId: 'FAM-NOVA' }),
      B: item({ value_name: 'FEIRA' }),
    }, ZAVEN, { aposPut: (_id, atual) => ({ ...atual, familyId: 'FAM-NOVA' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts.map((p) => p.itemId)).toEqual(['B']);
    expect(r.body).toMatchObject({ corrigidos: ['SKU2'], jaCertos: ['SKU1'] });
    expect(f.familyIdsGravados).toEqual([]); // ainda não unificada no início da rodada
  });

  it('pendentes espalhados em duas famílias antigas → nenhum PUT', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }, { familyId: 'FAM-9' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(0);
    expect(r.body).toMatchObject({ parouEm: { sku: null } });
  });

  it('certos em duas famílias → nenhum PUT', async () => {
    const f = fake({
      A: item({ value_name: 'Zaven' }, { familyId: 'FAM-X' }), B: item({ value_name: 'Zaven' }, { familyId: 'FAM-Y' }),
      C: item({ value_name: 'FEIRA' }),
    });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(0);
  });
});
