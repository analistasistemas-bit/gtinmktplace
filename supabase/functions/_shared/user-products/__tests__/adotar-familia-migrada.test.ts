import { describe, it, expect } from 'vitest';
import {
  adotarFamiliaMigrada,
  type PortasAdocao,
  type IrmaoRemoto,
  type EntradaAdocao,
} from '../adotar-familia-migrada';
import type { BuscaSku } from '../../ml/buscar-item';

const SELLER = '111222';

function irmao(over: Partial<IrmaoRemoto> = {}): IrmaoRemoto {
  return {
    familyId: 'FAM-9', familyName: 'AGULHA CROCHE', userProductId: 'UP-1',
    permalink: 'https://ml/x', status: 'active', sellerId: SELLER, temVariacoes: false,
    ...over,
  };
}

/** Mundo fake: mapa sku → resultado de busca, e itemId → estado remoto. */
function fakeMundo(opts: {
  busca?: Record<string, BuscaSku>;
  remoto?: Record<string, IrmaoRemoto | null>;
} = {}) {
  const adocoes: Array<{ filhos: unknown[]; familyId: string; familyName: string; mlItemId: string }> = [];
  const portas: PortasAdocao = {
    buscarPorSku: (sku) => Promise.resolve(opts.busca?.[sku] ?? { tipo: 'nenhum' }),
    // `in` (não `??`): um `null` explícito no mapa significa "GET falhou" e precisa chegar ao
    // módulo como null — `?? irmao()` o engoliria e o teste passaria sem testar nada.
    confirmar: (id) => Promise.resolve(
      opts.remoto && id in opts.remoto ? opts.remoto[id] : irmao(),
    ),
    adotar: (d) => { adocoes.push(d); return Promise.resolve(); },
  };
  return { portas, adocoes };
}

function entrada(over: Partial<EntradaAdocao> = {}): EntradaAdocao {
  return {
    skus: ['A', 'B', 'C'],
    sellerEsperado: SELLER,
    mlItemIdAtual: 'MLB-A',
    familyNameObservado: 'AGULHA CROCHE',
    ...over,
  };
}

const achou = (id: string): BuscaSku => ({ tipo: 'um', itemExternoId: id });
const TRES_OK = { A: achou('MLB-A'), B: achou('MLB-B'), C: achou('MLB-C') };

describe('adotarFamiliaMigrada — adoção feliz', () => {
  it('N SKUs resolvem para N irmãos sob 1 family_id → adota o conjunto inteiro', async () => {
    const w = fakeMundo({ busca: TRES_OK });
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('adotada');
    if (r.tipo !== 'adotada') return;
    expect(r.familyId).toBe('FAM-9');
    expect(r.filhos.map((f) => f.sku)).toEqual(['A', 'B', 'C']);
    expect(r.filhos.map((f) => f.itemExternoId)).toEqual(['MLB-A', 'MLB-B', 'MLB-C']);
    expect(w.adocoes).toHaveLength(1);
    expect(w.adocoes[0]).toMatchObject({ familyId: 'FAM-9', familyName: 'AGULHA CROCHE' });
  });

  it('status remoto mapeado explicitamente (active→ativo, paused→pausado)', async () => {
    const w = fakeMundo({
      busca: TRES_OK,
      remoto: { 'MLB-A': irmao(), 'MLB-B': irmao({ status: 'paused' }), 'MLB-C': irmao() },
    });
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('adotada');
    if (r.tipo !== 'adotada') return;
    expect(r.filhos.map((f) => f.status)).toEqual(['ativo', 'pausado', 'ativo']);
  });
});

describe('adotarFamiliaMigrada — re-apontamento determinístico de ml_item_id (§3)', () => {
  it('o item original sobreviveu à migração → ml_item_id apontado para ele', async () => {
    const w = fakeMundo({ busca: TRES_OK });
    await adotarFamiliaMigrada(w.portas, entrada({ mlItemIdAtual: 'MLB-B' }));
    expect(w.adocoes[0].mlItemId).toBe('MLB-B');
  });

  it('o item original NÃO está entre os irmãos → menor SKU, ordem estável', async () => {
    const w = fakeMundo({ busca: { A: achou('MLB-A'), B: achou('MLB-B'), C: achou('MLB-C') } });
    // ordem de entrada embaralhada: a regra é o menor SKU, não a ordem da lista.
    await adotarFamiliaMigrada(w.portas, entrada({ skus: ['C', 'B', 'A'], mlItemIdAtual: 'MLB-DISSOLVIDO' }));
    expect(w.adocoes[0].mlItemId).toBe('MLB-A');
  });
});

describe('adotarFamiliaMigrada — tudo-ou-nada (nada gravado, mensagem com contagens)', () => {
  it('SKU não encontrado → aborta, nada gravado, contagens na mensagem', async () => {
    const w = fakeMundo({ busca: { A: achou('MLB-A'), B: achou('MLB-B') } }); // 'C' → nenhum
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('incompleta');
    if (r.tipo !== 'incompleta') return;
    expect(r.mensagem).toContain('2 de 3');
    expect(r.mensagem).toContain('Não encontradas: C');
    expect(r.mensagem).toContain('Nada foi alterado');
    expect(w.adocoes).toEqual([]);
  });

  it('busca ambígua → aborta (nunca escolhe um)', async () => {
    const w = fakeMundo({ busca: { ...TRES_OK, C: { tipo: 'ambiguo' } } });
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('incompleta');
    if (r.tipo !== 'incompleta') return;
    expect(r.mensagem).toContain('Busca ambígua: C');
    expect(w.adocoes).toEqual([]);
  });

  it('paginação truncada → aborta (nunca assume conjunto completo)', async () => {
    const w = fakeMundo({ busca: { ...TRES_OK, B: { tipo: 'truncado' } } });
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('incompleta');
    expect(w.adocoes).toEqual([]);
  });

  it('irmão de OUTRO vendedor → recusado, aborta', async () => {
    const w = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-C': irmao({ sellerId: '999' }) } });
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('incompleta');
    if (r.tipo !== 'incompleta') return;
    expect(r.mensagem).toContain('Recusadas na validação: C');
    expect(w.adocoes).toEqual([]);
  });

  it('irmão Legacy (tem variations) → recusado, aborta', async () => {
    const w = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-B': irmao({ temVariacoes: true }) } });
    expect((await adotarFamiliaMigrada(w.portas, entrada())).tipo).toBe('incompleta');
    expect(w.adocoes).toEqual([]);
  });

  it.each(['closed', 'under_review', 'formato_futuro_do_ml', null])(
    'status remoto desconhecido (%s) → recusado, sem default silencioso',
    async (status) => {
      const w = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-A': irmao({ status: status as string | null }) } });
      expect((await adotarFamiliaMigrada(w.portas, entrada())).tipo).toBe('incompleta');
      expect(w.adocoes).toEqual([]);
    },
  );

  it('sem family_id ou user_product_id → não é UP genuíno, aborta', async () => {
    const semFam = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-A': irmao({ familyId: null }) } });
    expect((await adotarFamiliaMigrada(semFam.portas, entrada())).tipo).toBe('incompleta');
    const semUp = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-A': irmao({ userProductId: null }) } });
    expect((await adotarFamiliaMigrada(semUp.portas, entrada())).tipo).toBe('incompleta');
    expect(semFam.adocoes).toEqual([]);
    expect(semUp.adocoes).toEqual([]);
  });

  it('GET do irmão falhou (null) → aborta, nada gravado', async () => {
    const w = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-B': null } });
    expect((await adotarFamiliaMigrada(w.portas, entrada())).tipo).toBe('incompleta');
    expect(w.adocoes).toEqual([]);
  });

  it('family_id divergente entre irmãos → aborta com os ids observados', async () => {
    const w = fakeMundo({ busca: TRES_OK, remoto: { 'MLB-C': irmao({ familyId: 'FAM-OUTRA' }) } });
    const r = await adotarFamiliaMigrada(w.portas, entrada());
    expect(r.tipo).toBe('incompleta');
    if (r.tipo !== 'incompleta') return;
    expect(r.mensagem).toContain('2 family_id diferentes');
    expect(r.mensagem).toContain('FAM-OUTRA');
    expect(w.adocoes).toEqual([]);
  });
});

describe('adotarFamiliaMigrada — só leitura remota', () => {
  it('nenhuma porta de escrita no ML é exposta; adoção feliz não chama nada além de busca/GET/adotar', async () => {
    const chamadas: string[] = [];
    const portas: PortasAdocao = {
      buscarPorSku: (sku) => { chamadas.push(`busca:${sku}`); return Promise.resolve(achou(`MLB-${sku}`)); },
      confirmar: (id) => { chamadas.push(`get:${id}`); return Promise.resolve(irmao()); },
      adotar: () => { chamadas.push('adotar'); return Promise.resolve(); },
    };
    await adotarFamiliaMigrada(portas, entrada({ skus: ['A', 'B'] }));
    expect(chamadas).toEqual(['busca:A', 'get:MLB-A', 'busca:B', 'get:MLB-B', 'adotar']);
    // O contrato PortasAdocao não tem criar/ativar/pausar/repor — impossível escrever no ML daqui.
    expect(Object.keys(portas).sort()).toEqual(['adotar', 'buscarPorSku', 'confirmar']);
  });
});
