import { describe, it, expect } from 'vitest';
import { itensPorFoto, moderadosDoBulk } from '../processar.ts';

// Linhas como as portas reais leem: variação (com o anúncio Legacy da família e a cópia de catálogo), capas e
// filhos UP (principal e cópia de catálogo).
describe('itensPorFoto', () => {
  it('foto de variação Legacy sem filho UP traz o ml_item_id da família e a cópia de catálogo da variação', () => {
    const m = itensPorFoto({
      variacoes: [{ imagem_path: 'ORG/a.jpg', codigo: 'A', familia_ml_item_id: 'MLB-LEG', catalog_listing_id: 'MLB-CAT-LEG' }],
      capas: [], filhos: [],
    });
    expect([...m.get('ORG/a.jpg')!].sort()).toEqual(['MLB-CAT-LEG', 'MLB-LEG']);
  });

  it('foto de variação UP traz o principal e a cópia de catálogo do filho; capa traz os filhos do PAI', () => {
    const m = itensPorFoto({
      variacoes: [{ imagem_path: 'ORG/b.jpg', codigo: 'B', familia_ml_item_id: 'MLB-B', catalog_listing_id: null }],
      capas: [{ path: 'ORG/capa.jpg', codigo_pai: 'PAI', ml_item_id: 'MLB-B' }],
      filhos: [
        { sku: 'B', codigo_pai: 'PAI', item_externo_id: 'MLB-B', catalog_listing_id: 'MLB-CAT-B' },
        { sku: 'C', codigo_pai: 'PAI', item_externo_id: 'MLB-C', catalog_listing_id: null },
      ],
    });
    expect([...m.get('ORG/b.jpg')!].sort()).toEqual(['MLB-B', 'MLB-CAT-B']);
    expect([...m.get('ORG/capa.jpg')!].sort()).toEqual(['MLB-B', 'MLB-C', 'MLB-CAT-B']);
  });
});

describe('moderadosDoBulk', () => {
  const ok = (id: string, status: string, sub: string[] = []) => ({ code: 200, body: { id, status, sub_status: sub } });

  it('marca moderado (forbidden, under_review, waiting_for_patch) e aceita ativo', () => {
    expect([...moderadosDoBulk(['A', 'B', 'C'], [
      ok('A', 'active'), ok('B', 'inactive', ['forbidden']), ok('C', 'under_review', ['waiting_for_patch']),
    ])].sort()).toEqual(['B', 'C']);
  });

  it('leitura incompleta lança: item faltando, código diferente de 200 ou envelope inválido', () => {
    expect(() => moderadosDoBulk(['A', 'B'], [ok('A', 'active')])).toThrow();
    expect(() => moderadosDoBulk(['A'], [{ code: 404, body: null }])).toThrow();
    expect(() => moderadosDoBulk(['A'], { erro: true })).toThrow();
  });
});
