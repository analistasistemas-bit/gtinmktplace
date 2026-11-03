import { describe, expect, it } from 'vitest';
import { diasDoMes, mesPorExtenso, opcoesDeMes, somarMeses, variacaoPp, variacaoRel } from '../relatorio-mensal-ui';
import { barraCascata, linhasCascata, lucroDoMes } from '../relatorio-mensal-ui';
import { kpisFixture, serieFixture } from '../export/__tests__/relatorio-mensal-fixture';

describe('cascata e série: só formatam o contrato (achados Codex Fatia 4)', () => {
  const k = kpisFixture({ gross_cents: 10_000, net_cents: 8_000, tax_cents: 1_000, cost_cents: 4_000, profit_cents: 3_000,
    covered_gross_cents: 10_000, ads_cost_cents: 500, profit_after_ads_cents: 2_500 });

  it('cada saída parte do saldo anterior do contrato: bruto 100, comissão/frete 20, imposto 10 → imposto em 70–80', () => {
    const linhas = linhasCascata(k);
    const barra = (chave: string) => barraCascata(linhas.find((l) => l.chave === chave)!, k.gross_cents);
    expect(linhas.find((l) => l.chave === 'canal')!.valor).toBe(2_000);
    expect(barra('canal')).toEqual({ esq: 0.8, larg: 0.2 });
    expect(barra('imposto')).toEqual({ esq: 0.7, larg: 0.1 });
    expect(barra('liquido')).toEqual({ esq: 0, larg: 0.7 });
    expect(barra('custo')).toEqual({ esq: 0.3, larg: 0.4 });
    expect(barra('ads')).toEqual({ esq: 0.25, larg: 0.05 });
  });

  it('saldo indisponível interrompe a barra (nunca desenha de um saldo inventado)', () => {
    const semImposto = linhasCascata(kpisFixture({ ...k, tax_cents: null, net_after_tax_cents: null }));
    expect(barraCascata(semImposto.find((l) => l.chave === 'imposto')!, 10_000)).toBeNull();
    expect(barraCascata(semImposto.find((l) => l.chave === 'custo')!, 10_000)).toBeNull();
    const parcial = linhasCascata(kpisFixture({ ...k, profit_partial: true }));
    expect(barraCascata(parcial.find((l) => l.chave === 'custo')!, 10_000)).toBeNull();
  });

  it('série: lucro e margem escolhidos por mês, com a margem do contrato (base calculável)', () => {
    const [a, b] = serieFixture(2);
    expect(lucroDoMes(a)).toEqual({ lucro: a.profit_after_ads_cents, margem: a.margin_after_ads, aposAds: true });
    const antes = { ...b, profit_after_ads_cents: null, margin_after_ads: null, profit_cents: 2_000, gross_cents: 10_000, margin: 0.5 };
    expect(lucroDoMes(antes)).toEqual({ lucro: 2_000, margem: 0.5, aposAds: false });
  });
});

describe('relatorio-mensal-ui', () => {
  it('mês por extenso e soma de meses cruzando o ano', () => {
    expect(mesPorExtenso('2026-10')).toBe('Outubro de 2026');
    expect(mesPorExtenso('lixo')).toBe('lixo');
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(somarMeses('2025-12', 1)).toBe('2026-01');
    expect(diasDoMes('2026-02')).toBe(28);
  });

  it('opções de mês: 24 meses terminando no atual, sempre com o selecionado', () => {
    const o = opcoesDeMes('2026-10', '2026-10');
    expect(o).toHaveLength(24);
    expect(o[0]).toBe('2026-10');
    expect(opcoesDeMes('2026-10', '2020-01')[0]).toBe('2020-01');
  });

  it('variação: base zero/ausente não gera %, inverso inverte o "bom", p.p. para razões', () => {
    expect(variacaoRel(10, 0)).toBeNull();
    expect(variacaoRel(10, null)).toBeNull();
    expect(variacaoRel(110, 100)).toMatchObject({ texto: '+10,0%', tendencia: 'up', bom: true });
    expect(variacaoRel(110, 100, true)).toMatchObject({ bom: false });
    expect(variacaoRel(90, 100)).toMatchObject({ texto: '−10,0%', tendencia: 'down' });
    expect(variacaoPp(0.3, 0.28)).toMatchObject({ texto: '+2,0 p.p.', bom: true });
    expect(variacaoPp(null, 0.28)).toBeNull();
  });
});
