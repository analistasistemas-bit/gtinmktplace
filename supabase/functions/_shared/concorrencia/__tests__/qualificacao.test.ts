import { describe, expect, it } from 'vitest';
import { qualificarOferta, resumirMercadoQualificado } from '../qualificacao.ts';

const base = {
  item_id: 'MLB1', seller_id: 1, preco: 70.19,
  frete_gratis: false, full: false,
  transactions_total: 10, visitas_30d: 1, nivel: '3_yellow',
};

describe('qualificarOferta', () => {
  it('qualifica exatamente 10 transações', () => {
    expect(qualificarOferta(base)).toEqual({ status: 'relevante', motivos: ['QUALIFICADO'] });
  });
  it('reprova 9 transações', () => {
    expect(qualificarOferta({ ...base, transactions_total: 9 })).toEqual({
      status: 'fora_referencia', motivos: ['POUCAS_TRANSACOES'],
    });
  });
  it('reprova zero visitas e aceita visitas não medidas', () => {
    expect(qualificarOferta({ ...base, visitas_30d: 0 }).status).toBe('fora_referencia');
    expect(qualificarOferta({ ...base, visitas_30d: null }).status).toBe('relevante');
  });
  it('reprova vermelho/laranja e aceita reputação ausente', () => {
    expect(qualificarOferta({ ...base, nivel: '1_red' }).status).toBe('fora_referencia');
    expect(qualificarOferta({ ...base, nivel: '2_orange' }).status).toBe('fora_referencia');
    expect(qualificarOferta({ ...base, nivel: null }).status).toBe('relevante');
  });
  it('mantém transações ausentes em observação', () => {
    expect(qualificarOferta({ ...base, transactions_total: null })).toEqual({
      status: 'observacao', motivos: ['DADOS_INSUFICIENTES'],
    });
  });
});

describe('resumirMercadoQualificado', () => {
  it('separa R$36 observado de R$70,19 relevante', () => {
    const r = resumirMercadoQualificado([
      { ...base, item_id: 'MLB36', preco: 36, transactions_total: 0, visitas_30d: 19 },
      { ...base, item_id: 'MLB70', preco: 70.19, transactions_total: 10, visitas_30d: 1 },
    ]);
    expect(r.menor_observado).toBe(36);
    expect(r.menor_relevante).toBe(70.19);
    expect(r.total_observadas).toBe(2);
    expect(r.total_relevantes).toBe(1);
  });
});
