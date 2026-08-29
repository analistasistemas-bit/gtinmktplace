import { describe, expect, it } from 'vitest';
import {
  LIMITACAO_3_2,
  montarSecoes237,
  MOTIVO_SEM_FATURAMENTO,
  type EntradaSecoes237,
} from '../relatorio-secoes-237.ts';

const snap = (seller_id: string, t0: number, t1: number) => [
  { seller_id, transactions_total: t0, dia: '2026-08-01' },
  { seller_id, transactions_total: t1, dia: '2026-08-31' },
];

const IDS = ['v1', 'v2', 'v3', 'v4', 'v5'];

// t0 = 100 (>= 50, ADR-0145 D-1): os 5 são estabelecidos. t1 = 121 → mediaMensal12m = 121/12.
function entrada(over: Partial<EntradaSecoes237> = {}): EntradaSecoes237 {
  return {
    anuncios: [],
    anunciosNaAmostra: 20,
    anunciosComCatalogo: 7,
    sellerIdsCatalogo: IDS,
    serie: IDS.flatMap((v) => snap(v, 100, 121)),
    ...over,
  };
}

describe('montarSecoes237', () => {
  it('2.9 declara o motivo de não haver faturamento (ADR-0143 D-3)', () => {
    const s = montarSecoes237(entrada());
    expect(s['2.9']).toEqual({ estado: 'sem_dado', mensagem: MOTIVO_SEM_FATURAMENTO });
    expect(s['2.9'].mensagem).toContain('loja inteira');
  });

  it('não expõe 2.6, 2.7, 2.8 nem 3.1 — o faturamento saiu do ar', () => {
    const s = montarSecoes237(entrada()) as Record<string, unknown>;
    for (const campo of ['2.6', '2.7', '2.8', '3.1']) {
      expect(s[campo]).toBeUndefined();
    }
  });

  it('3.2 sai da mediana da média mensal de 12 meses (total mais recente ÷ 12) — ADR-0146 D-1', () => {
    const s = montarSecoes237(entrada());
    expect(s['3.2'].estado).toBe('valor');
    if (s['3.2'].estado !== 'valor') return;
    expect(s['3.2'].vendas_mes_mediana).toBeCloseTo(121 / 12, 6);
    expect(s['3.2'].rotulo).toContain('média mensal dos últimos 12 meses');
  });

  it('3.3 usa o total da amostra e os anúncios com catálogo (spike 045)', () => {
    const s = montarSecoes237(entrada({ anunciosNaAmostra: 104, anunciosComCatalogo: 26 }));
    expect(s['3.3'].anuncios_na_amostra).toBe(104);
    expect(s['3.3'].anuncios_com_catalogo).toBe(26);
    expect(s['3.3'].proporcao_anuncios).toBeCloseTo(26 / 104, 6);
    expect(s['3.3'].rotulo).toContain('26 de 104 anúncios');
  });

  it('3.4 declara quem a régua excluiu, não um zero mudo (ADR-0146 Errata 1)', () => {
    const s = montarSecoes237(entrada({
      sellerIdsCatalogo: [...IDS, 'p1', 'p2'],
      serie: [...IDS.flatMap((v) => snap(v, 100, 121)), ...snap('p1', 10, 12), ...snap('p2', 4, 4)],
    }));
    expect(s['3.4'].contagem).toBe(2);
    expect(s['3.4'].total_no_catalogo).toBe(7);
    expect(s['3.4'].rotulo).toContain('2 de 7 concorrentes ficaram de fora');
    expect(s['3.4'].rotulo).not.toMatch(/venderam/i);
  });

  it('inclui limitacao_3_2 com as duas ressalvas (loja inteira e catálogo)', () => {
    const s = montarSecoes237(entrada());
    expect(s.limitacao_3_2).toBe(LIMITACAO_3_2);
    expect(s.limitacao_3_2).toContain('loja inteira');
    expect(s.limitacao_3_2).toContain('catálogos desta amostra');
  });

  it('amostra vazia não quebra', () => {
    const s = montarSecoes237(entrada({
      anunciosNaAmostra: 0, anunciosComCatalogo: 0, sellerIdsCatalogo: [], serie: [],
    }));
    expect(s['3.2'].estado).toBe('sem_dado');
    expect(s['7.4']).toBeNull();
  });

  it('3.6 traz a tendência dos 5 estabelecidos — todos com delta positivo, crescendo (ADR-0146)', () => {
    const s = montarSecoes237(entrada());
    expect(s['3.6'].estabelecidos).toBe(5);
    expect(s['3.6'].crescendo).toBe(5);
    expect(s['3.6'].estaveis).toBe(0);
    expect(s['3.6'].encolhendo).toBe(0);
    expect(s['3.6'].base_pequena).toBe(false);
    expect(s['3.6'].rotulo).toContain('5 de 5 vendedores estabelecidos vendendo mais que há um ano');
  });

  it('com 1 a 4 estabelecidos, 3.2 vira sem_dado e 3.6 mostra base_pequena — critério aceite 5', () => {
    const poucos = ['v1', 'v2', 'v3'];
    const s = montarSecoes237(entrada({
      sellerIdsCatalogo: poucos,
      serie: poucos.flatMap((v) => snap(v, 100, 121)),
    }));
    expect(s['3.2'].estado).toBe('sem_dado');
    expect(s['3.6'].estabelecidos).toBe(3);
    expect(s['3.6'].base_pequena).toBe(true);
  });

  it('nenhum rótulo do payload contém "365" nem "movimento observado" — critério aceite 6', () => {
    const s = montarSecoes237(entrada());
    const payload = JSON.stringify(s);
    expect(payload).not.toContain('365');
    expect(payload).not.toContain('movimento observado');
  });
});
