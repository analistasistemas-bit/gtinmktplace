import { describe, it, expect } from 'vitest';
import { agruparCatalogoRisco, ROTULO_RISCO, STATUS_RISCO, type FamiliaRiscoRow } from '../catalogo-risco';

const fam = (over: Partial<FamiliaRiscoRow> = {}): FamiliaRiscoRow => ({
  id: 'f1', ml_item_id: 'MLB100', titulo_ml: 'Fita Cetim N.3', nome_pai: 'FITA CETIM',
  variacoes: [], ...over,
});
const v = (catalog_status: string | null, ml_variation_id: string | null = '111') =>
  ({ catalog_status, ml_variation_id });

describe('agruparCatalogoRisco', () => {
  it('agrega os quatro status de risco e conta por anúncio', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [v('ficha_divergente'), v('sem_produto'), v('nao_elegivel'), v('pendente'), v('vinculado')],
    })]);
    expect(r).toHaveLength(1);
    expect(r[0].qtdSemFicha).toBe(4);
    expect(r[0].url).toBe('https://www.mercadolivre.com.br/produzir/catalogo/MLB100');
  });

  it('REGRESSÃO: variação com ml_variation_id nulo (nunca publicada) não conta — família só com elas não aparece', () => {
    const r = agruparCatalogoRisco([fam({ variacoes: [v('pendente', null), v('pendente', null)] })]);
    expect(r).toHaveLength(0);
  });

  it('motivo predominante = status com mais variações; empate resolve pela ordem de STATUS_RISCO', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [v('pendente'), v('pendente'), v('sem_produto')],
    })]);
    expect(r[0].motivoPredominante).toBe('pendente');
    const empate = agruparCatalogoRisco([fam({ variacoes: [v('sem_produto'), v('pendente')] })]);
    expect(empate[0].motivoPredominante).toBe('sem_produto'); // sem_produto vem antes na ordem
  });

  it('família sem ml_item_id ou sem variação em risco não aparece', () => {
    expect(agruparCatalogoRisco([fam({ ml_item_id: null, variacoes: [v('pendente')] })])).toHaveLength(0);
    expect(agruparCatalogoRisco([fam({ variacoes: [v('vinculado'), v('family_diff')] })])).toHaveLength(0);
  });

  it('famílias que compartilham ml_item_id (ciclos de UPDATE) somam num anúncio só', () => {
    const r = agruparCatalogoRisco([
      fam({ id: 'f1', variacoes: [v('pendente')] }),
      fam({ id: 'f2', titulo_ml: null, variacoes: [v('sem_produto')] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].qtdSemFicha).toBe(2);
  });

  it('título cai para nome_pai e por fim para o ml_item_id', () => {
    const r = agruparCatalogoRisco([fam({ titulo_ml: null, variacoes: [v('pendente')] })]);
    expect(r[0].titulo).toBe('FITA CETIM');
  });

  it('rótulos pt-BR cobrem todos os status', () => {
    for (const s of STATUS_RISCO) expect(ROTULO_RISCO[s]).toBeTruthy();
  });
});
