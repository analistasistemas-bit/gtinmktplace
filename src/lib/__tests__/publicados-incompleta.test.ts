// Publicação incompleta (incidente 2026-09-10, adendo do ADR-0088): anúncio vivo no ML que o app
// não concluiu. Estas linhas existem justamente para NÃO sumirem da tela — foi o sumiço que deixou
// um kit vendendo sem baixar estoque. Trava o filtro dedicado e a convivência com os outros.
import { describe, it, expect } from 'vitest';
import { filtrarPublicados, dedupePublicados, type PublicadoItem } from '../publicados';

const base = (over: Partial<PublicadoItem> = {}): PublicadoItem => ({
  familiaId: 'f1', codigoPai: 'P1', gtin: null, titulo: 't', fornecedor: null, tipo: null,
  categoria: null, precoPublicacao: 10, precoPublicacaoMax: 10, descricao: null,
  mlItemId: 'M1', mlPermalink: null, publicadoEm: null, ...over,
});

describe('filtro "somenteIncompletos"', () => {
  it('deixa passar só as publicações incompletas', () => {
    const itens = [
      base({ mlItemId: 'M1', status: 'ativo' }),
      base({ mlItemId: 'M2', publicacaoIncompleta: true, status: 'ativo' }),
      base({ mlItemId: 'M3', status: 'pausado' }),
    ];
    expect(filtrarPublicados(itens, { somenteIncompletos: true }).map((i) => i.mlItemId)).toEqual(['M2']);
  });

  it('sem o filtro, a incompleta aparece junto com as demais (é o ponto: não sumir)', () => {
    const itens = [base({ mlItemId: 'M1' }), base({ mlItemId: 'M2', publicacaoIncompleta: true })];
    expect(filtrarPublicados(itens, {}).map((i) => i.mlItemId)).toEqual(['M1', 'M2']);
  });

  it('combina com os outros filtros em vez de sobrescrevê-los', () => {
    const itens = [
      base({ mlItemId: 'M1', publicacaoIncompleta: true, fornecedor: 'ACME' }),
      base({ mlItemId: 'M2', publicacaoIncompleta: true, fornecedor: 'OUTRO' }),
    ];
    const r = filtrarPublicados(itens, { somenteIncompletos: true, fornecedor: 'ACME' });
    expect(r.map((i) => i.mlItemId)).toEqual(['M1']);
  });
});

describe('convivência com o dedupe por anúncio', () => {
  it('a incompleta tem mlItemId próprio (o id real do anúncio) e não colide com as publicadas', () => {
    const r = dedupePublicados([
      base({ mlItemId: 'MLB1', publicadoEm: '2026-09-01T00:00:00Z' }),
      base({ mlItemId: 'MLB2', publicacaoIncompleta: true }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.find((i) => i.mlItemId === 'MLB2')?.publicacaoIncompleta).toBe(true);
  });
});
