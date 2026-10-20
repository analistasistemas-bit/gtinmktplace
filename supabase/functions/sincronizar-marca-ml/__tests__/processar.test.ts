import { describe, it, expect } from 'vitest';
import { processarSincronizacaoMarca, type DepsMarca, type ItemLido, type SincronizarMarcaJob, type StatusMarca } from '../processar';

const JOB = { org_id: 'org-z', codigo_pai: '00000064' };

function item(brand: { value_name: string; value_id?: string | null } | null, over: Partial<ItemLido> = {}): ItemLido {
  return {
    status: 'paused', familyId: 'FAM-1',
    attrs: brand ? [{ id: 'BRAND', ...brand }, { id: 'COLOR', value_name: 'Azul' }] : [{ id: 'COLOR', value_name: 'Azul' }],
    ...over,
  };
}

/** ML em memória: cada PUT grava os atributos; `aposPut` permite simular efeito colateral. */
function fake(itens: Record<string, ItemLido>, marca: string | null = 'Zaven', opts: {
  aposPut?: (id: string, atual: ItemLido) => ItemLido;
  falhaPut?: (id: string) => Error | null;
  falhaLeitura?: boolean;
  versao?: number;
  /** versão vista no meio da rodada (simula edição nova). */
  versaoNaRodada?: number;
  leaseOcupado?: boolean;
  publicado?: boolean;
  falhaReagendar?: boolean;
} = {}) {
  const status: Array<{ status: StatusMarca; erro?: string; versao: number }> = [];
  const reagendados: Array<{ job: SincronizarMarcaJob; delay: number }> = [];
  const lease = { adquirido: 0, liberado: 0 };
  const puts: Array<{ itemId: string; attrs: Array<{ id: string; value_name: string }> }> = [];
  let leituras = 0;
  const familyIdsGravados: Array<{ familyId: string; itemIds: string[] }> = [];
  const deps: DepsMarca = {
    lerEstado: async () => (opts.publicado === false ? null : { raizId: 'R', versao: opts.versao ?? 1, marca }),
    adquirirLease: async () => { if (opts.leaseOcupado) return false; lease.adquirido++; return true; },
    liberarLease: async () => { lease.liberado++; },
    versaoAtual: async () => opts.versaoNaRodada ?? opts.versao ?? 1,
    gravarStatus: async (_r, versao, st, erro) => { status.push({ status: st, erro, versao }); },
    reagendar: async (job, delay) => {
      if (opts.falhaReagendar) throw new Error('qstash fora');
      reagendados.push({ job, delay });
    },
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
  return { deps, puts, familyIdsGravados, status, reagendados, lease, leituras: () => leituras };
}

describe('processarSincronizacaoMarca (ADR-0186)', () => {
  it('produto sem marca → 400, status erro e nada é lido do ML', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, null);
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.status).toBe(400);
    expect(f.leituras()).toBe(0);
    expect(f.status).toEqual([{ status: 'erro', erro: 'Produto sem marca definida.', versao: 1 }]);
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
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, 'Zaven', {
      aposPut: (_id, atual) => ({ ...atual, status: 'active' }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toHaveLength(1);
    expect(r.body).toMatchObject({ parouEm: { sku: 'SKU1' } });
  });

  it('family_id null na releitura → para', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, 'Zaven', {
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
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, 'Zaven', {
      falhaPut: () => Object.assign(new Error('item paused não pode ser editado'), { status: 400 }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ parouEm: { sku: 'SKU1', motivo: expect.stringContaining('paused') } });
  });

  it('erro de leitura antes de qualquer PUT → 500 (QStash retenta)', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { falhaLeitura: true });
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
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }), C: item({ value_name: 'FEIRA' }) }, 'Zaven', {
      aposPut: (_id, atual) => ({ ...atual, familyId: 'FAM-NOVA' }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts.map((p) => p.itemId)).toEqual(['A', 'B', 'C']);
    expect(r.body).toMatchObject({ corrigidos: ['SKU1', 'SKU2', 'SKU3'] });
    expect(r.body).not.toHaveProperty('parouEm');
  });

  it('segunda família nova diferente da primeira → para', async () => {
    let n = 0;
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }), C: item({ value_name: 'FEIRA' }) }, 'Zaven', {
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
    }, 'Zaven', { aposPut: (_id, atual) => ({ ...atual, familyId: 'FAM-NOVA' }) });
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

  it('ao fim da rodada, SKUs corrigidos espalhados em duas famílias novas → parouEm (cenário do Codex)', async () => {
    const itens = { A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }), C: item({ value_name: 'FEIRA' }) };
    const f = fake(itens, 'Zaven', {
      aposPut: (id, atual) => {
        if (id === 'B') { itens.A = { ...itens.A, familyId: 'N1' }; return { ...atual, familyId: 'N2' }; }
        return atual;
      },
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.body).toMatchObject({ parouEm: { sku: null, motivo: expect.stringContaining('após a rodada') } });
  });

  it('ao fim da rodada, todos numa única família nova → sem parouEm', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) }, 'Zaven', {
      aposPut: (_id, atual) => ({ ...atual, familyId: 'N1' }),
    });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.body).not.toHaveProperty('parouEm');
  });

});

describe('orquestração (ADR-0188)', () => {
  it('usa a marca do produto (Lacoste) e não a da org', async () => {
    const f = fake({ A: item({ value_name: 'Zaven' }) }, 'Lacoste');
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.puts).toEqual([{ itemId: 'A', attrs: [{ id: 'BRAND', value_name: 'Lacoste' }] }]);
  });

  it('corrigiu SKUs → reagenda a rodada de convergência (tentativa 1, 120 s) e status pendente', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) });
    await processarSincronizacaoMarca(f.deps, { ...JOB, versao: 1 });
    expect(f.reagendados).toEqual([{ job: { ...JOB, versao: 1, tentativa: 1 }, delay: 120 }]);
    expect(f.status.at(-1)?.status).toBe('pendente');
  });

  it('duas execuções: a 2ª não faz PUT, grava o family_id e fecha com status ok', async () => {
    const itens = { A: item({ value_name: 'FEIRA' }), B: item({ value_name: 'FEIRA' }) };
    const f = fake(itens, 'Zaven', { aposPut: (_id, a) => ({ ...a, familyId: 'FAM-NOVA' }) });
    await processarSincronizacaoMarca(f.deps, JOB);
    const putsDa1a = f.puts.length;
    await processarSincronizacaoMarca(f.deps, f.reagendados[0].job);
    expect(f.puts.length).toBe(putsDa1a);
    expect(f.familyIdsGravados.at(-1)?.familyId).toBe('FAM-NOVA');
    expect(f.status.at(-1)?.status).toBe('ok');
  });

  it('todos certos mas em duas famílias (convergindo) → reagenda, não é erro', async () => {
    const f = fake({ A: item({ value_name: 'Zaven' }), B: item({ value_name: 'Zaven' }, { familyId: 'FAM-NOVA' }) });
    const r = await processarSincronizacaoMarca(f.deps, JOB);
    expect(r.body).toMatchObject({ convergindo: true });
    expect(f.reagendados).toHaveLength(1);
    expect(f.status.at(-1)?.status).toBe('pendente');
  });

  it('esgotou as 5 tentativas convergindo → status erro, sem reagendar', async () => {
    const f = fake({ A: item({ value_name: 'Zaven' }), B: item({ value_name: 'Zaven' }, { familyId: 'FAM-NOVA' }) });
    await processarSincronizacaoMarca(f.deps, { ...JOB, tentativa: 5 });
    expect(f.reagendados).toHaveLength(0);
    expect(f.status.at(-1)).toMatchObject({ status: 'erro', erro: expect.stringContaining('não convergiu') });
  });

  it('erro transitório de leitura → reagenda (não fica pendente eterno)', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { falhaLeitura: true });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.reagendados).toHaveLength(1);
    expect(f.puts).toHaveLength(0);
  });

  it('falha ao reagendar → status erro', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { falhaReagendar: true });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.status.at(-1)).toMatchObject({ status: 'erro', erro: expect.stringContaining('reagendar') });
  });

  it('job de versão antiga → não lê o ML, não faz PUT nem grava status', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { versao: 2 });
    const r = await processarSincronizacaoMarca(f.deps, { ...JOB, versao: 1 });
    expect(r.body).toEqual({ ignorado: 'versão antiga' });
    expect(f.leituras()).toBe(0);
    expect(f.status).toHaveLength(0);
  });

  it('edição nova no meio da rodada → para antes do PUT e não grava status', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { versao: 1, versaoNaRodada: 2 });
    const r = await processarSincronizacaoMarca(f.deps, { ...JOB, versao: 1 });
    expect(f.puts).toHaveLength(0);
    expect(r.body).toMatchObject({ versaoNova: true });
    expect(f.status).toHaveLength(0);
  });

  it('lease ocupado (outra execução intercalada) → nenhum PUT, reagenda em 30 s sem contar tentativa', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { leaseOcupado: true });
    await processarSincronizacaoMarca(f.deps, { ...JOB, versao: 1 });
    expect(f.puts).toHaveLength(0);
    expect(f.reagendados).toEqual([{ job: { ...JOB, versao: 1 }, delay: 30 }]);
  });

  it('lease é liberado mesmo quando a rodada falha', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { falhaPut: () => new Error('x') });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.lease).toEqual({ adquirido: 1, liberado: 1 });
  });

  it('anúncio sem SKUs UP (Legacy) → status erro com orientação', async () => {
    const f = fake({});
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.status.at(-1)).toMatchObject({ status: 'erro', erro: expect.stringContaining('Legacy') });
  });

  it('parouEm (ML recusou) → status erro com o motivo', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) }, 'Zaven', { falhaPut: () => new Error('item bloqueado') });
    await processarSincronizacaoMarca(f.deps, JOB);
    expect(f.status.at(-1)).toMatchObject({ status: 'erro', erro: expect.stringContaining('item bloqueado') });
  });

  it('dry_run → sem lease, sem status, sem reagendar', async () => {
    const f = fake({ A: item({ value_name: 'FEIRA' }) });
    await processarSincronizacaoMarca(f.deps, { ...JOB, dry_run: true });
    expect(f.lease.adquirido).toBe(0);
    expect(f.status).toHaveLength(0);
    expect(f.reagendados).toHaveLength(0);
  });
});
