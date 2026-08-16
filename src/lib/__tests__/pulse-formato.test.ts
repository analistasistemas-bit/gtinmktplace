import { describe, it, expect } from 'vitest';
import {
  seloPriceToWin, ordemPriceToWin, motivoSemPrecoProprio, tipoAnuncio, reputacao, posicaoVsMercado,
} from '../pulse-formato';

const vinculado = (ptw_status: string | null) =>
  ({ ptw_status, catalogo_status: 'vinculado', origem: 'auto' }) as const;

describe('seloPriceToWin', () => {
  // Os quatro status que /suggestions/items/{id}/details realmente devolve, com o significado da
  // documentação do ML. Traduzir por aproximação já produziu bug: "no_benchmark_lowest" foi lido
  // como "sem concorrência" e a tela dizia isso num produto com 79 ofertas.
  it('traduz os quatro status de referência de preço do ML', () => {
    expect(seloPriceToWin(vinculado('no_benchmark_lowest'))?.texto).toBe('Abaixo da referência');
    expect(seloPriceToWin(vinculado('no_benchmark_ok'))?.texto).toBe('Na referência');
    expect(seloPriceToWin(vinculado('with_benchmark_high'))?.texto).toBe('Acima da referência');
    expect(seloPriceToWin(vinculado('with_benchmark_highest'))?.texto).toBe('Acima de todos');
    expect(seloPriceToWin(vinculado('with_benchmark_highest'))?.tom).toBe('risco');
  });

  it('nenhum status descreve ausência de concorrentes', () => {
    for (const s of ['no_benchmark_lowest', 'no_benchmark_ok', 'with_benchmark_high', 'with_benchmark_highest']) {
      expect(seloPriceToWin(vinculado(s))?.texto).not.toMatch(/concorrência/i);
    }
  });

  it('estados de Markdown viram promoção, e ficam fora da escala de preço', () => {
    expect(seloPriceToWin(vinculado('promotion_active'))?.texto).toBe('Promoção ativa');
    expect(seloPriceToWin(vinculado('not_optin_applied'))?.texto).toBe('Promoção sugerida');
    // 99 = "sem posição na escala", não "o mais caro".
    expect(ordemPriceToWin(vinculado('promotion_active'))).toBe(99);
  });

  it('escala ordena do mais barato ao mais caro', () => {
    const escala = ['no_benchmark_lowest', 'no_benchmark_ok', 'with_benchmark_high', 'with_benchmark_highest']
      .map((s) => ordemPriceToWin(vinculado(s))!);
    expect(escala).toEqual([...escala].sort((a, b) => a - b));
    expect(new Set(escala).size).toBe(4);
  });

  it('status desconhecido não vaza jargão de API nem sugere posição de preço', () => {
    const s = seloPriceToWin(vinculado('status_novo_do_ml'));
    expect(s?.texto).toBe('Status não reconhecido');
    expect(s?.ajuda).toContain('status_novo_do_ml');
    expect(ordemPriceToWin(vinculado('status_novo_do_ml'))).toBe(99);
  });

  it('sem referência e sem vínculo: explica a causa (era um traço mudo)', () => {
    const s = seloPriceToWin({ ptw_status: null, catalogo_status: 'ficha_divergente', origem: 'auto' });
    expect(s?.texto).toBe('Sem vínculo de catálogo');
    expect(s?.tom).toBe('atencao');
    expect(s?.ajuda).toContain('não está vinculado');
  });

  it('ficha manual: a referência é sobre anúncio nosso, então não se aplica', () => {
    const s = seloPriceToWin({ ptw_status: null, catalogo_status: null, origem: 'manual' });
    expect(s?.texto).toBe('Você não vende');
  });

  it('vinculado mas ainda sem avaliação do ML: nada a dizer', () => {
    expect(seloPriceToWin({ ptw_status: null, catalogo_status: 'vinculado', origem: 'auto' })).toBeNull();
  });
});

describe('motivoSemPrecoProprio', () => {
  const base = {
    origem: 'auto' as const,
    catalogo_status: 'vinculado',
    ultimo_snapshot_em: '2026-08-16T00:00:00Z',
    meu_preco_em: '2026-08-16T22:08:09Z',
  };

  it('ficha manual: não é anúncio nosso', () => {
    expect(motivoSemPrecoProprio({ ...base, origem: 'manual' })).toContain('você não vende');
  });

  it('antes da primeira coleta, a causa é a coleta — não o anúncio', () => {
    expect(motivoSemPrecoProprio({ ...base, ultimo_snapshot_em: null })).toContain('primeira coleta');
  });

  // Cada execução tem teto de produtos: uma sobra fica para o ciclo seguinte com o preço nunca
  // lido. Dizer "pausado" ali é afirmar sobre o anúncio a partir de uma leitura que não houve.
  it('produto que a coleta ainda não alcançou não é chamado de pausado', () => {
    const s = motivoSemPrecoProprio({ ...base, meu_preco_em: null });
    expect(s).toContain('ainda não lido');
    expect(s).not.toContain('pausado');
  });

  it('sem vínculo de catálogo: causa acionável', () => {
    expect(motivoSemPrecoProprio({ ...base, catalogo_status: 'ficha_divergente' })).toContain('não está vinculado');
  });

  it('lido, vinculado, mas fora da ficha: pausado ou sem estoque', () => {
    expect(motivoSemPrecoProprio(base)).toContain('pausado ou sem estoque');
  });

  it('sempre explica — nunca devolve vazio, que leria como tela quebrada', () => {
    const casos = [
      base,
      { ...base, origem: 'manual' as const },
      { ...base, catalogo_status: null },
      { ...base, ultimo_snapshot_em: null },
      { ...base, meu_preco_em: null },
    ];
    for (const c of casos) expect(motivoSemPrecoProprio(c).length).toBeGreaterThan(10);
  });
});

describe('tipoAnuncio', () => {
  it('traduz o jargão do ML', () => {
    expect(tipoAnuncio('gold_special')).toBe('Clássico');
    expect(tipoAnuncio('gold_pro')).toBe('Premium');
    expect(tipoAnuncio(null)).toBe('—');
  });
});

describe('reputacao', () => {
  it('devolve null quando o vendedor não tem selo (evita o "—·" solto)', () => {
    expect(reputacao(null)).toBeNull();
    expect(reputacao('gold')).toBe('MercadoLíder Gold');
  });
});

describe('posicaoVsMercado', () => {
  it('mais caro que o menor concorrente', () => {
    const p = posicaoVsMercado(115, 100)!;
    expect(p.texto).toBe('+15% mais caro');
    expect(p.tom).toBe('risco');
  });

  it('acima mas pouco: atenção, não risco', () => {
    expect(posicaoVsMercado(105, 100)!.tom).toBe('atencao');
  });

  it('mais barato — sem o sinal, que negaria a própria frase', () => {
    const p = posicaoVsMercado(90, 100)!;
    expect(p.texto).toBe('10% mais barato');
    expect(p.tom).toBe('ok');
  });

  it('diferença irrelevante vira empate', () => {
    expect(posicaoVsMercado(100.2, 100)!.texto).toBe('Empatado');
  });

  it('sem preço nosso ou sem concorrente: nada a comparar', () => {
    expect(posicaoVsMercado(null, 100)).toBeNull();
    expect(posicaoVsMercado(100, null)).toBeNull();
    expect(posicaoVsMercado(100, 0)).toBeNull();
  });
});
