import { describe, it, expect } from 'vitest';
import { seloPriceToWin, tipoAnuncio, reputacao, posicaoVsMercado } from '../pulse-formato';

describe('seloPriceToWin', () => {
  it('traduz os status conhecidos do ML', () => {
    expect(seloPriceToWin({ ptw_status: 'with_benchmark_high', catalogo_status: 'vinculado', origem: 'auto' })?.texto)
      .toBe('Acima da média');
    expect(seloPriceToWin({ ptw_status: 'with_benchmark_highest', catalogo_status: 'vinculado', origem: 'auto' })?.tom)
      .toBe('risco');
  });

  it('status desconhecido não vaza jargão de API para a tela (código fica no tooltip)', () => {
    const s = seloPriceToWin({ ptw_status: 'status_novo_do_ml', catalogo_status: 'vinculado', origem: 'auto' });
    expect(s?.texto).toBe('Sem referência');
    expect(s?.ajuda).toContain('status_novo_do_ml');
  });

  it('sem price-to-win e sem vínculo: explica a causa (era um traço mudo)', () => {
    const s = seloPriceToWin({ ptw_status: null, catalogo_status: 'ficha_divergente', origem: 'auto' });
    expect(s?.texto).toBe('Sem vínculo de catálogo');
    expect(s?.tom).toBe('atencao');
    expect(s?.ajuda).toContain('não está vinculado');
  });

  it('ficha manual: o price-to-win é sobre anúncio nosso, então não se aplica', () => {
    const s = seloPriceToWin({ ptw_status: null, catalogo_status: null, origem: 'manual' });
    expect(s?.texto).toBe('Você não vende');
  });

  it('vinculado mas ainda sem avaliação do ML: nada a dizer', () => {
    expect(seloPriceToWin({ ptw_status: null, catalogo_status: 'vinculado', origem: 'auto' })).toBeNull();
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
