import { describe, it, expect } from 'vitest';
import { agruparCatalogoRisco, filtrarCatalogForewarning, ROTULO_RISCO, STATUS_RISCO, type FamiliaRiscoRow, type AnuncioEmRisco } from '../catalogo-risco';

const fam = (over: Partial<FamiliaRiscoRow> = {}): FamiliaRiscoRow => ({
  id: 'f1', ml_item_id: 'MLB100', titulo_ml: 'Fita Cetim N.3', nome_pai: 'FITA CETIM',
  variacoes: [], ...over,
});
const v = (catalog_status: string | null, ml_variation_id: string | null = '111') =>
  ({ catalog_status, ml_variation_id, catalog_product_id: null });

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

describe('agruparCatalogoRisco — dados para a extensão (Fase 3)', () => {
  const fam = (over: Partial<FamiliaRiscoRow>): FamiliaRiscoRow => ({
    id: 'f1', ml_item_id: 'MLB1', titulo_ml: 'Anúncio', nome_pai: null, variacoes: [], ...over,
  });

  it('coleta variacoesRisco (só as publicadas em status de risco)', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [
        { catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null },
        { catalog_status: 'pendente', ml_variation_id: '222', catalog_product_id: null },
        { catalog_status: 'pendente', ml_variation_id: null, catalog_product_id: null }, // nunca publicada
      ],
    })]);
    expect(r[0].variacoesRisco).toEqual(['111', '222']);
  });

  it('coleta vinculos das variações vinculado do MESMO anúncio', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [
        { catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null },
        { catalog_status: 'vinculado', ml_variation_id: '333', catalog_product_id: 'MLB999' },
      ],
    })]);
    expect(r[0].vinculos).toEqual({ '333': 'MLB999' });
  });

  it('vinculado sem catalog_product_id não entra em vinculos', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [
        { catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null },
        { catalog_status: 'vinculado', ml_variation_id: '333', catalog_product_id: null },
      ],
    })]);
    expect(r[0].vinculos).toEqual({});
  });

  it('família só com vinculado não vira anúncio em risco, mas seus vinculos agregam no mesmo ml_item_id', () => {
    const r = agruparCatalogoRisco([
      fam({ id: 'f1', variacoes: [{ catalog_status: 'sem_produto', ml_variation_id: '111', catalog_product_id: null }] }),
      fam({ id: 'f2', variacoes: [{ catalog_status: 'vinculado', ml_variation_id: '444', catalog_product_id: 'MLB777' }] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].vinculos).toEqual({ '444': 'MLB777' });
  });

  it('marca itemPlano quando ml_variation_id === ml_item_id', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [{ catalog_status: 'pendente', ml_variation_id: 'MLB1', catalog_product_id: null }],
    })]);
    expect(r[0].itemPlano).toBe(true);
  });

  it('multivariação normal tem itemPlano false', () => {
    const r = agruparCatalogoRisco([fam({
      variacoes: [{ catalog_status: 'pendente', ml_variation_id: '555', catalog_product_id: null }],
    })]);
    expect(r[0].itemPlano).toBe(false);
  });
});

describe('filtrarCatalogForewarning — só a tag do ML decide (mudança de escopo 2026-08-13)', () => {
  const item = (over: Partial<AnuncioEmRisco> = {}): AnuncioEmRisco => ({
    mlItemId: 'MLB1', titulo: 'Anúncio', qtdSemFicha: 1, motivoPredominante: 'pendente',
    url: 'https://www.mercadolivre.com.br/produzir/catalogo/MLB1',
    variacoesRisco: [], vinculos: {}, itemPlano: false, ...over,
  });

  it('anúncio com a tag aparece', () => {
    const r = filtrarCatalogForewarning([item({ mlItemId: 'MLB1' })], new Set(['MLB1']));
    expect(r).toEqual([item({ mlItemId: 'MLB1' })]);
  });

  it('anúncio sem a tag não aparece', () => {
    const r = filtrarCatalogForewarning([item({ mlItemId: 'MLB1' })], new Set(['MLB2']));
    expect(r).toEqual([]);
  });

  it('conjunto de tags vazio → lista vazia', () => {
    const r = filtrarCatalogForewarning([item({ mlItemId: 'MLB1' }), item({ mlItemId: 'MLB2' })], new Set());
    expect(r).toEqual([]);
  });

  it('mistura: só os sinalizados sobrevivem, preservando os demais campos', () => {
    const r = filtrarCatalogForewarning(
      [item({ mlItemId: 'MLB1' }), item({ mlItemId: 'MLB2' }), item({ mlItemId: 'MLB3' })],
      new Set(['MLB2']),
    );
    expect(r).toEqual([item({ mlItemId: 'MLB2' })]);
  });
});
