import { describe, it, expect } from 'vitest';
import {
  publicarGrupo, type PortasSaga, type FilhoRow, type StatusFilho, type ConfirmacaoRemota,
} from '../publicar-grupo';
import type { BuscaSku } from '../../ml/buscar-item';

// ── Fakes em memória (a saga é pura: recebe as portas por parâmetro, nunca toca rede/banco) ──
//
// "reservar" é INSERT-IF-ABSENT (nunca clobber): um retry preserva item_externo_id/status
// das linhas que já existem — mesma semântica do ON CONFLICT DO NOTHING do adapter real.

interface ItemRemoto { status: 'ativo' | 'pausado'; familyId: string; userProductId: string; existe: boolean; seller: string; }

function fakeMundo(opts: {
  seed?: FilhoRow[];               // linhas filhas já existentes (retry)
  busca?: (sku: string) => BuscaSku;
  criarFamilyId?: (sku: string) => string;   // family_id que o item criado vai reportar
  falharCriacaoNoSku?: string;     // simula crash na fase de criação (POST falha nesse SKU)
  falharAtivacaoNoSku?: string;    // simula ativação parcial (PUT ativo falha nesse SKU)
  confirmarInesperadoNoSku?: string; // simula estado remoto inesperado no GET de confirmação
} = {}) {
  const db = new Map<string, FilhoRow>();
  for (const r of opts.seed ?? []) db.set(r.sku, { ...r });
  const remoto = new Map<string, ItemRemoto>(); // itemExternoId → estado no ML
  let estadoDesejado: 'ativando' | 'pausando' | null = null;
  const chamadas = { criarPlano: 0, mudarStatus: [] as Array<{ id: string; status: string }> };
  let seq = 1000;
  const skuPorItem = new Map<string, string>(); // itemExternoId → sku (p/ family_id por sku)

  const get = (sku: string) => db.get(sku) ?? { sku, status: 'pendente' as StatusFilho, retirado: false, itemExternoId: null };

  const portas: PortasSaga = {
    listar: () => Promise.resolve([...db.values()].map((r) => ({ ...r }))),
    reservar: (_id, skus) => {
      for (const sku of skus) if (!db.has(sku)) db.set(sku, { sku, status: 'pendente', retirado: false, itemExternoId: null });
      return Promise.resolve();
    },
    salvarStatus: (_id, sku, status) => { db.set(sku, { ...get(sku), status }); return Promise.resolve(); },
    salvarCriado: (_id, sku, itemExternoId) => {
      db.set(sku, { ...get(sku), status: 'criado', itemExternoId });
      skuPorItem.set(itemExternoId, sku);
      if (!remoto.has(itemExternoId)) {
        remoto.set(itemExternoId, {
          status: 'ativo', existe: true, seller: 'seller-1',
          familyId: opts.criarFamilyId?.(sku) ?? 'FAM-1', userProductId: 'UP-1',
        });
      }
      return Promise.resolve();
    },
    buscarPorSku: (sku) => Promise.resolve(opts.busca?.(sku) ?? { tipo: 'nenhum' }),
    criarPlano: (sku) => {
      if (opts.falharCriacaoNoSku && sku === opts.falharCriacaoNoSku) {
        return Promise.reject(new Error('ML recusou POST /items'));
      }
      chamadas.criarPlano++;
      const itemExternoId = `MLB${seq++}`;
      skuPorItem.set(itemExternoId, sku);
      // ML cria ATIVO por padrão (a saga pausa em seguida via mudarStatus)
      remoto.set(itemExternoId, {
        status: 'ativo', existe: true, seller: 'seller-1',
        familyId: opts.criarFamilyId?.(sku) ?? 'FAM-1', userProductId: 'UP-1',
      });
      return Promise.resolve({ itemExternoId, permalink: `https://ml/${itemExternoId}` });
    },
    confirmar: (itemExternoId): Promise<ConfirmacaoRemota> => {
      const sku = skuPorItem.get(itemExternoId);
      if (opts.confirmarInesperadoNoSku && sku === opts.confirmarInesperadoNoSku) {
        return Promise.resolve({ ok: false });
      }
      const it = remoto.get(itemExternoId);
      if (!it || !it.existe) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, familyId: it.familyId, userProductId: it.userProductId, permalink: `https://ml/${itemExternoId}` });
    },
    salvarConfirmacao: (_id, sku, dados) => {
      db.set(sku, { ...get(sku), itemExternoId: get(sku).itemExternoId });
      void dados;
      return Promise.resolve();
    },
    mudarStatus: (itemExternoId, status) => {
      chamadas.mudarStatus.push({ id: itemExternoId, status });
      const sku = skuPorItem.get(itemExternoId);
      if (status === 'ativo' && opts.falharAtivacaoNoSku && sku === opts.falharAtivacaoNoSku) {
        return Promise.reject(new Error('ML recusou ativação'));
      }
      const it = remoto.get(itemExternoId);
      if (it) it.status = status;
      return Promise.resolve();
    },
    salvarEstadoDesejado: (_id, estado) => { estadoDesejado = estado; return Promise.resolve(); },
  };

  return { portas, db, remoto, chamadas, get estadoDesejado() { return estadoDesejado; } };
}

const skus9 = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];

describe('publicarGrupo — saga "tudo ou pausa" (segura p/ retry sequencial)', () => {
  it('9 SKUs OK: cria, confirma family_id único, ativa todos → estado ativo', async () => {
    const m = fakeMundo();
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: skus9 });
    expect(r.estado).toBe('ativo');
    expect(m.chamadas.criarPlano).toBe(9);
    const linhas = [...m.db.values()];
    expect(linhas.every((l) => l.status === 'ativo')).toBe(true);
    expect(new Set(linhas.map((l) => l.itemExternoId)).size).toBe(9);
    // family_id único confirmado
    expect(new Set([...m.remoto.values()].map((i) => i.familyId)).size).toBe(1);
    // estado_desejado limpo ao final
    expect(m.estadoDesejado).toBe(null);
  });

  it('cria cada item pausado (staging) antes de ativar: mudarStatus pausa então ativa', async () => {
    const m = fakeMundo();
    await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1'] });
    const seq = m.chamadas.mudarStatus.map((c) => c.status);
    expect(seq).toEqual(['pausado', 'ativo']); // pausado no staging, ativo na ativação
  });

  it('retry reaproveita IDs persistidos: cria só os que faltam (não repete POST)', async () => {
    // 7 já criados (com id), 2 sem id
    const seed: FilhoRow[] = skus9.map((sku, i) =>
      i < 7
        ? { sku, status: 'criado' as StatusFilho, retirado: false, itemExternoId: `PRE${i}` }
        : { sku, status: 'pendente' as StatusFilho, retirado: false, itemExternoId: null },
    );
    const m = fakeMundo({ seed });
    // registra os pré-existentes no "ML" para o confirmar achá-los
    for (let i = 0; i < 7; i++) m.remoto.set(`PRE${i}`, { status: 'pausado', existe: true, seller: 'seller-1', familyId: 'FAM-1', userProductId: 'UP-1' });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: skus9 });
    expect(m.chamadas.criarPlano).toBe(2); // só os 2 faltantes
    expect(r.estado).toBe('ativo');
  });

  it('item órfão encontrado por seller_custom_field é adotado, não duplicado (0 POST extra)', async () => {
    const m = fakeMundo({
      busca: (sku) => (sku === 's1' ? { tipo: 'um', itemExternoId: 'ORFAO1' } : { tipo: 'nenhum' }),
    });
    m.remoto.set('ORFAO1', { status: 'ativo', existe: true, seller: 'seller-1', familyId: 'FAM-1', userProductId: 'UP-1' });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1', 's2'] });
    expect(m.chamadas.criarPlano).toBe(1); // só s2; s1 adotado
    expect(m.db.get('s1')?.itemExternoId).toBe('ORFAO1');
    expect(r.estado).toBe('ativo');
  });

  it('linha em criacao_incerta é reprocessada pela própria saga (não fica travada)', async () => {
    const seed: FilhoRow[] = [{ sku: 's1', status: 'criacao_incerta', retirado: false, itemExternoId: null }];
    const m = fakeMundo({ seed });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1'] });
    expect(m.db.get('s1')?.status).toBe('ativo'); // resolvida, não presa em criacao_incerta
    expect(r.estado).toBe('ativo');
  });

  it('busca por SKU ambígua bloqueia adoção → erro, nunca adota o primeiro', async () => {
    const m = fakeMundo({ busca: () => ({ tipo: 'ambiguo' }) });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1', 's2'] });
    expect(r.estado).toBe('erro');
    expect(m.chamadas.criarPlano).toBe(0); // nunca cria após ambiguidade
  });

  it('busca truncada bloqueia adoção → erro', async () => {
    const m = fakeMundo({ busca: () => ({ tipo: 'truncado' }) });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1'] });
    expect(r.estado).toBe('erro');
  });

  it('family_id divergente pausa todos e falha (familia_up_desagrupada), nunca ativa', async () => {
    const m = fakeMundo({ criarFamilyId: (sku) => (sku === 's2' ? 'FAM-OUTRA' : 'FAM-1') });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1', 's2'] });
    expect(r.estado).toBe('erro');
    expect(r.codigo).toBe('familia_up_desagrupada');
    // nenhum item ficou ativo (todos pausados como compensação)
    expect([...m.remoto.values()].every((i) => i.status === 'pausado')).toBe(true);
    // nenhuma ativação disparada
    expect(m.chamadas.mudarStatus.some((c) => c.status === 'ativo')).toBe(false);
  });

  it('ativação parcial (falha no 4º) → compensacao_pendente, nunca publicado; estado_desejado mantido', async () => {
    const skus4 = ['s1', 's2', 's3', 's4'];
    const m = fakeMundo({ falharAtivacaoNoSku: 's4' });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: skus4 });
    expect(r.estado).toBe('compensacao_pendente');
    // todos os filhos marcados compensacao_pendente (aggregação → compensacao_pendente)
    expect([...m.db.values()].every((l) => l.status === 'compensacao_pendente')).toBe(true);
    // compensação pausou todos os conhecidos (nenhum item ativo órfão)
    expect([...m.remoto.values()].every((i) => i.status === 'pausado')).toBe(true);
    // estado_desejado='ativando' PERMANECE (reconciliador reativa)
    expect(m.estadoDesejado).toBe('ativando');
  });

  it('falha na criação do SKU 8 de 9: pausa os 7 já criados (compensação) e re-lança p/ retry', async () => {
    const m = fakeMundo({ falharCriacaoNoSku: 's8' });
    // crash de criação re-lança (worker QStash reprocessa) — distinto dos desfechos que retornam
    await expect(publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: skus9 })).rejects.toThrow();
    // os itens já criados (s1..s7) foram pausados como ação de compensação (nenhum ativo órfão)
    expect(m.chamadas.criarPlano).toBe(7);
    expect([...m.remoto.values()].every((i) => i.status === 'pausado')).toBe(true);
    // nenhuma ativação disparada
    expect(m.chamadas.mudarStatus.some((c) => c.status === 'ativo')).toBe(false);
    // s8 fica em criacao_incerta (marcada ANTES do POST) — resolvida pela própria saga no retry
    expect(m.db.get('s8')?.status).toBe('criacao_incerta');
  });

  it('estado remoto inesperado (confirmação 404) → erro, sem ativar', async () => {
    const m = fakeMundo({ confirmarInesperadoNoSku: 's2' });
    const r = await publicarGrupo(m.portas, { anuncioExternoId: 'p0', skusEsperados: ['s1', 's2'] });
    expect(r.estado).toBe('erro');
    expect(r.codigo).toBe('estado_remoto_inesperado');
    expect(m.chamadas.mudarStatus.some((c) => c.status === 'ativo')).toBe(false);
  });
});
