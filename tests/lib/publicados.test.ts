import { describe, it, expect } from 'vitest';
import { filtrarPublicados, dedupePublicados } from '../../src/lib/publicados';
import type { PublicadoItem } from '../../src/lib/publicados';

const fixtures: PublicadoItem[] = [
  {
    familiaId: 'f1',
    codigoPai: '00100001',
    titulo: 'Fita Cetim Vermelho 10MT',
    fornecedor: 'Avil',
    tipo: 'fita',
    precoPublicacao: 12.9,
    mlItemId: 'MLB111',
    mlPermalink: null,
    publicadoEm: '2026-06-01T00:00:00Z',
    status: 'ativo',
    estoque: 50,
    precoAtual: 12.9,
    motivo: null,
  },
  {
    familiaId: 'f2',
    codigoPai: '00200001',
    titulo: 'Linha Bordado Azul 1500MT',
    fornecedor: 'Coats',
    tipo: 'linha',
    precoPublicacao: 8.5,
    mlItemId: 'MLB222',
    mlPermalink: 'https://ml.com/MLB222',
    publicadoEm: '2026-06-02T00:00:00Z',
    status: 'pausado',
    estoque: 0,
    precoAtual: 8.5,
    motivo: null,
  },
  {
    familiaId: 'f3',
    codigoPai: '00300001',
    titulo: 'Botao Redondo Preto 12mm',
    fornecedor: 'Avil',
    tipo: 'botao',
    precoPublicacao: 4.0,
    mlItemId: 'MLB333',
    mlPermalink: 'https://ml.com/MLB333',
    publicadoEm: '2026-06-03T00:00:00Z',
    status: 'ativo',
    estoque: 200,
    precoAtual: 4.0,
    motivo: null,
  },
  {
    familiaId: 'f4',
    codigoPai: '00400001',
    titulo: 'Fita Gorgurão Rosa 5MT',
    fornecedor: 'Coats',
    tipo: 'fita',
    precoPublicacao: 6.75,
    mlItemId: 'MLB444',
    mlPermalink: null,
    publicadoEm: null,
    status: 'moderado',
    estoque: null,
    precoAtual: null,
    motivo: 'poor_quality_thumbnail',
  },
];

describe('filtrarPublicados', () => {
  it('filtro vazio retorna todos os itens', () => {
    const result = filtrarPublicados(fixtures, {});
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('filtra por fornecedor', () => {
    const result = filtrarPublicados(fixtures, { fornecedor: 'Avil' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f3']);
  });

  it('filtra por status', () => {
    const result = filtrarPublicados(fixtures, { status: 'ativo' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f3']);
  });

  it('filtra por tipo', () => {
    const result = filtrarPublicados(fixtures, { tipo: 'fita' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f4']);
  });

  it('filtra por busca case-insensitive e parcial no titulo', () => {
    const result = filtrarPublicados(fixtures, { busca: 'bordado' });
    expect(result.map((i) => i.familiaId)).toEqual(['f2']);
  });

  it('busca parcial encontra substring independente do caso', () => {
    const result = filtrarPublicados(fixtures, { busca: 'FITA' });
    expect(result.map((i) => i.familiaId)).toEqual(['f1', 'f4']);
  });

  it('filtro combinado fornecedor + status restringe mais que cada um isolado', () => {
    // fornecedor='Avil' → f1, f3 (2 itens)
    // status='ativo'   → f1, f3 (2 itens, mas por coincidência iguais)
    // fornecedor='Coats' + status='pausado' → apenas f2
    const resultFornecedor = filtrarPublicados(fixtures, { fornecedor: 'Coats' });
    const resultStatus = filtrarPublicados(fixtures, { status: 'pausado' });
    const resultCombinado = filtrarPublicados(fixtures, { fornecedor: 'Coats', status: 'pausado' });

    expect(resultFornecedor.map((i) => i.familiaId)).toEqual(['f2', 'f4']);
    expect(resultStatus.map((i) => i.familiaId)).toEqual(['f2']);
    expect(resultCombinado.map((i) => i.familiaId)).toEqual(['f2']);
    expect(resultCombinado.length).toBeLessThanOrEqual(resultFornecedor.length);
  });
});

describe('dedupePublicados', () => {
  const base = (over: Partial<PublicadoItem>): PublicadoItem => ({
    familiaId: 'x', codigoPai: '001', titulo: 'Produto', fornecedor: null,
    tipo: 'fita', precoPublicacao: 10, mlItemId: 'MLB1', mlPermalink: null,
    publicadoEm: null, ...over,
  });

  it('colapsa várias linhas do mesmo ml_item_id em uma só', () => {
    const out = dedupePublicados([
      base({ familiaId: 'a' }), base({ familiaId: 'b' }), base({ familiaId: 'c' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mlItemId).toBe('MLB1');
  });

  it('mantém ml_item_ids distintos separados', () => {
    const out = dedupePublicados([base({ mlItemId: 'MLB1' }), base({ mlItemId: 'MLB2' })]);
    expect(out.map((i) => i.mlItemId).sort()).toEqual(['MLB1', 'MLB2']);
  });

  it('representante: publicado real (publicadoEm) vence o não publicado', () => {
    const out = dedupePublicados([
      base({ familiaId: 'draft', publicadoEm: null }),
      base({ familiaId: 'real', publicadoEm: '2026-06-05T00:00:00Z' }),
    ]);
    expect(out[0].familiaId).toBe('real');
  });

  it('entre publicados, escolhe o mais antigo (publicação original)', () => {
    const out = dedupePublicados([
      base({ familiaId: 'novo', publicadoEm: '2026-06-07T00:00:00Z' }),
      base({ familiaId: 'orig', publicadoEm: '2026-06-04T00:00:00Z' }),
    ]);
    expect(out[0].familiaId).toBe('orig');
  });

  it('preenche fornecedor de qualquer linha do grupo quando o representante não tem', () => {
    const out = dedupePublicados([
      base({ familiaId: 'rep', publicadoEm: '2026-06-04T00:00:00Z', fornecedor: null }),
      base({ familiaId: 'comFornecedor', publicadoEm: null, fornecedor: 'BUFALO' }),
    ]);
    expect(out[0].familiaId).toBe('rep');
    expect(out[0].fornecedor).toBe('BUFALO');
  });
});
