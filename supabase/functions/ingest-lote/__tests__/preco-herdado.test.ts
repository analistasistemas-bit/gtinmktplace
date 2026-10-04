import { describe, it, expect } from 'vitest';
import { casarVariacoesUpdate } from '../../_shared/update/casar';
import { precoHerdadoUpdate } from '../preco-herdado';

// D1 do reajuste: cor reajustada (marca true, preço X) + cor nova no mesmo re-ingest.
const anteriores = [
  { codigo: '00000101', ml_variation_id: 'V1', cor: 'Azul', cor_origem: 'manual', ml_picture_id: 'P1', estoque: 5, preco_publicacao: 49.9, preco_editado_pelo_operador: true },
  { codigo: '00000102', ml_variation_id: 'V2', cor: 'Verde', cor_origem: 'manual', ml_picture_id: 'P2', estoque: 5, preco_publicacao: 39.9, preco_editado_pelo_operador: false },
];

describe('precoHerdadoUpdate — herança da marca de preço fixado no re-ingest', () => {
  const cas = casarVariacoesUpdate(
    [{ codigo: '00000101' }, { codigo: '00000102' }, { codigo: '00000999' }], anteriores,
  );

  it('cor reajustada mantém o preço X e a marca true', () => {
    expect(precoHerdadoUpdate(cas.herdados['00000101'], 39.9, 10))
      .toEqual({ preco_publicacao: 49.9, preco_editado_pelo_operador: true });
  });

  it('cor casada sem marca segue igual a antes (marca false)', () => {
    expect(precoHerdadoUpdate(cas.herdados['00000102'], 39.9, 10))
      .toEqual({ preco_publicacao: 39.9, preco_editado_pelo_operador: false });
  });

  it('cor nova herda o preço da família e nasce sem marca (process-familia recalcula)', () => {
    expect(precoHerdadoUpdate(cas.herdados['00000999'], 39.9, 10))
      .toEqual({ preco_publicacao: 39.9, preco_editado_pelo_operador: false });
    expect(precoHerdadoUpdate(cas.herdados['00000999'], null, 10))
      .toEqual({ preco_publicacao: 10, preco_editado_pelo_operador: false });
  });

  it('process-familia só recalcula quem não tem a marca (mesmo filtro de index.ts:458)', () => {
    const vars = ['00000101', '00000102', '00000999'].map((codigo) => ({
      codigo, ...precoHerdadoUpdate(cas.herdados[codigo], 39.9, 10),
    }));
    expect(vars.filter((v) => !v.preco_editado_pelo_operador).map((v) => v.codigo))
      .toEqual(['00000102', '00000999']);
  });
});
