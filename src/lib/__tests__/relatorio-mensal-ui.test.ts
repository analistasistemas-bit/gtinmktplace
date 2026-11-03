import { describe, expect, it } from 'vitest';
import { diasDoMes, mesPorExtenso, opcoesDeMes, somarMeses, variacaoPp, variacaoRel } from '../relatorio-mensal-ui';

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
