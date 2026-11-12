import { describe, expect, it } from 'vitest';
import { filtrarPublicados, type PublicadoItem } from '../publicados';

function item(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'fam-1',
    codigoPai: '00001',
    gtin: null,
    titulo: 'Botão de Pressão Inox',
    fornecedor: null,
    tipo: 'outro',
    categoria: 'Botões',
    precoPublicacao: 19.9,
    precoPublicacaoMax: 19.9,
    descricao: null,
    mlItemId: 'MLB7168683146',
    mlPermalink: null,
    publicadoEm: '2026-08-01',
    status: 'ativo',
    ...over,
  };
}

describe('filtrarPublicados — busca pelo código do anúncio ML', () => {
  const outro = item({ familiaId: 'fam-2', codigoPai: '00002', mlItemId: 'MLB999' });

  it.each(['MLB7168683146', 'MLB-7168683146', 'mlb-7168683146', '7168683146'])(
    'acha por "%s"',
    (busca) => {
      const r = filtrarPublicados([item(), outro], { busca });
      expect(r.map((x) => x.familiaId)).toEqual(['fam-1']);
    },
  );

  it('acha pelo id de um SKU de família User Products', () => {
    const up = item({ mlItemId: 'MLB1', mlItemIdsUP: ['MLB1', 'MLB5551'] });
    expect(filtrarPublicados([up, outro], { busca: 'MLB-5551' })).toHaveLength(1);
  });
});
