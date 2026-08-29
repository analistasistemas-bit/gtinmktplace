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

function entrada(over: Partial<EntradaSecoes237> = {}): EntradaSecoes237 {
  return {
    anuncios: [],
    anunciosNaAmostra: 20,
    anunciosComCatalogo: 7,
    sellerIdsCatalogo: IDS,
    serie: IDS.flatMap((v) => snap(v, 0, 21)),
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

  it('3.2 sai da mediana dos vendedores do catálogo', () => {
    const s = montarSecoes237(entrada());
    expect(s['3.2'].estado).toBe('valor');
    if (s['3.2'].estado !== 'valor') return;
    expect(s['3.2'].vendas_mes_mediana).toBeCloseTo(21, 0);
  });

  it('3.3 usa o total da amostra e os anúncios com catálogo (spike 045)', () => {
    const s = montarSecoes237(entrada({ anunciosNaAmostra: 104, anunciosComCatalogo: 26 }));
    expect(s['3.3'].anuncios_na_amostra).toBe(104);
    expect(s['3.3'].anuncios_com_catalogo).toBe(26);
    expect(s['3.3'].proporcao_anuncios).toBeCloseTo(26 / 104, 6);
    expect(s['3.3'].rotulo).toContain('26 de 104 anúncios');
  });

  it('3.4 rotula sem estimativa mensal, nunca venderam', () => {
    const s = montarSecoes237(entrada({
      sellerIdsCatalogo: ['x'],
      serie: [{ seller_id: 'x', transactions_total: 100, dia: '2026-08-01' }],
    }));
    expect(s['3.4'].contagem).toBe(1);
    expect(s['3.4'].rotulo).toContain('sem estimativa mensal');
    expect(s['3.4'].rotulo.toLowerCase()).not.toContain('venderam');
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
});
