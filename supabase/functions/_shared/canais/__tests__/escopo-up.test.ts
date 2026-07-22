import { describe, it, expect } from 'vitest';
import { unirIdsUP, estenderEscopoModeracao } from '../escopo-up';

// ADR-0088 §2 — correção financeira PRÉ-REQUISITO de go-live: sem unir os itens filhos User
// Products (anuncios_externos_itens, 1 por SKU/cor) ao familias.ml_item_id legado (só a 1ª
// cor/partição 0), vendas/moderação/status das cores 2..N ficam fora do escopo da org.

describe('unirIdsUP (metricas-vendas / status-publicados)', () => {
  it('família UP de 9 cores: ml_item_id (1ª cor) + 8 filhos → 9 ids no escopo, nenhum de fora', () => {
    const mlItemId = 'MLB1'; // familias.ml_item_id = 1º item da partição 0 (ADR §5)
    const itensUP = ['MLB1', 'MLB2', 'MLB3', 'MLB4', 'MLB5', 'MLB6', 'MLB7', 'MLB8', 'MLB9'];
    const escopo = unirIdsUP([mlItemId], itensUP);
    expect(escopo.sort()).toEqual(itensUP.sort());
    expect(escopo).toHaveLength(9);
  });

  it('dedup: cor 1 aparece em ambas as listas (familias.ml_item_id == 1º filho) sem duplicar', () => {
    const escopo = unirIdsUP(['MLB1'], ['MLB1', 'MLB2', 'MLB3']);
    expect(escopo.sort()).toEqual(['MLB1', 'MLB2', 'MLB3']);
  });

  it('só famílias legado (nenhum item UP) → comportamento de hoje preservado', () => {
    expect(unirIdsUP(['MLB1', 'MLB2'], [])).toEqual(['MLB1', 'MLB2']);
  });

  it('só itens filhos UP (família sem ml_item_id ainda) → ainda entram no escopo', () => {
    expect(unirIdsUP([], ['MLB2', 'MLB3']).sort()).toEqual(['MLB2', 'MLB3']);
  });

  it('filtra null/undefined vindos de .map em linhas sem item_externo_id', () => {
    expect(unirIdsUP(['MLB1', null, undefined], ['MLB2', null])).toEqual(['MLB1', 'MLB2']);
  });

  it('sem nenhum id (org sem publicações) → escopo vazio', () => {
    expect(unirIdsUP([], [])).toEqual([]);
  });
});

describe('estenderEscopoModeracao (monitorar-moderados)', () => {
  it('família UP de 3+ filhos: cores 2..N entram no mapa mesmo sem nome próprio (fallback ao id)', () => {
    const base = new Map([['MLB1', { nome: 'AGULHA CROCHÊ', permalink: 'https://ml/MLB1' }]]);
    const itensUP = [
      { item_externo_id: 'MLB1', permalink: 'https://ml/MLB1' }, // cor 1, já no mapa — não deve sobrescrever
      { item_externo_id: 'MLB2', permalink: 'https://ml/MLB2' }, // cor 2
      { item_externo_id: 'MLB3', permalink: 'https://ml/MLB3' }, // cor 3
    ];
    const estendido = estenderEscopoModeracao(base, itensUP);
    expect([...estendido.keys()].sort()).toEqual(['MLB1', 'MLB2', 'MLB3']);
    // cor 1 preserva nome/permalink originais da família (não clobbered pelo filho UP).
    expect(estendido.get('MLB1')).toEqual({ nome: 'AGULHA CROCHÊ', permalink: 'https://ml/MLB1' });
    // cores 2..N: sem nome próprio (cai no fallback ml_item_id do alerta), permalink do próprio item.
    expect(estendido.get('MLB2')).toEqual({ nome: null, permalink: 'https://ml/MLB2' });
    expect(estendido.get('MLB3')).toEqual({ nome: null, permalink: 'https://ml/MLB3' });
  });

  it('não muta o Map base recebido (pura)', () => {
    const base = new Map([['MLB1', { nome: 'X', permalink: null }]]);
    estenderEscopoModeracao(base, [{ item_externo_id: 'MLB2', permalink: null }]);
    expect(base.has('MLB2')).toBe(false);
  });

  it('item filho sem item_externo_id (ainda não publicado no ML) é ignorado', () => {
    const estendido = estenderEscopoModeracao(new Map(), [{ item_externo_id: null, permalink: null }]);
    expect(estendido.size).toBe(0);
  });
});
