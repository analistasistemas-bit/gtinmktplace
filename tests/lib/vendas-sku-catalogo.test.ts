import { describe, it, expect } from 'vitest';
import { mapCatalogoSku } from '@/lib/vendas-sku-catalogo';

describe('mapCatalogoSku', () => {
  it('converte o JSON da RPC em CatalogoSku', () => {
    expect(mapCatalogoSku({
      codigo: '09300001', codigo_pai: '09300000', nome_familia: 'Fita', nome: 'Fita azul', cor: 'Azul',
      tamanho: null, estoque: 9, fornecedor: 'B', origem: 'importado', eh_kit: false,
      primeira_venda: '2026-07-01T12:00:00+00:00', ultima_venda: null,
    })).toEqual({
      codigo: '09300001', codigoPai: '09300000', nomeFamilia: 'Fita', nome: 'Fita azul', cor: 'Azul',
      tamanho: null, estoque: 9, fornecedor: 'B', origem: 'importado', ehKit: false,
      primeiraVenda: '2026-07-01T12:00:00+00:00', ultimaVenda: null,
    });
  });

  it('origem fora de nacional/importado vira null (nunca presumida)', () => {
    expect(mapCatalogoSku({ codigo: 'x', estoque: 0, eh_kit: false, origem: 'NACIONAL ' }).origem).toBeNull();
  });
});
