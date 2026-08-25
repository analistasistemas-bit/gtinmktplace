import { describe, it, expect } from 'vitest';
import { montarMensagemEstoqueZerado, montarMensagemVoltaAoAr } from '../estoque';

const base = {
  produto: 'Sabonete Líquido Nivea 200ml',
  codigoPai: '00000028',
  permalink: 'https://produto.mercadolivre.com.br/MLB5040504553',
};

describe('montarMensagemEstoqueZerado', () => {
  it('produto inteiro zerado avisa que o anúncio foi pausado e como voltar', () => {
    const m = montarMensagemEstoqueZerado({
      ...base,
      zeradas: [{ codigo: '00000029', nome: null, cor: null }],
      produtoInteiroZerado: true,
    });
    expect(m).toContain('anúncio pausado no Mercado Livre');
    expect(m).toContain('Repor o estoque reativa');
    expect(m).toContain(base.permalink);
  });

  it('variação isolada não diz que o anúncio saiu do ar — ele continua vendendo as outras', () => {
    const m = montarMensagemEstoqueZerado({
      ...base,
      zeradas: [{ codigo: '00000029', nome: 'Azul', cor: 'Azul' }],
      produtoInteiroZerado: false,
    });
    expect(m).toContain('segue no ar');
    expect(m).not.toContain('pausado');
    expect(m).not.toContain('Repor o estoque reativa');
  });

  it('agrupa as variações zeradas do mesmo push numa mensagem só', () => {
    const m = montarMensagemEstoqueZerado({
      ...base,
      zeradas: [
        { codigo: '00000029', nome: null, cor: 'Azul' },
        { codigo: '00000030', nome: null, cor: 'Verde' },
      ],
      produtoInteiroZerado: false,
    });
    expect(m).toContain('2 variações');
    expect(m).toContain('Azul (00000029)');
    expect(m).toContain('Verde (00000030)');
  });

  it('sem nome de produto usa o código pai, e sem permalink não deixa linha vazia', () => {
    const m = montarMensagemEstoqueZerado({
      produto: null, codigoPai: '00000028', permalink: null,
      zeradas: [{ codigo: '00000029', nome: null, cor: null }],
      produtoInteiroZerado: true,
    });
    expect(m).toContain('00000028');
    expect(m.endsWith('\n')).toBe(false);
    expect(m).not.toContain('\n\n');
  });
});

describe('montarMensagemVoltaAoAr', () => {
  it('confirma a reativação e leva ao anúncio', () => {
    const m = montarMensagemVoltaAoAr(base);
    expect(m).toContain('voltou ao ar');
    expect(m).toContain(base.produto);
    expect(m).toContain(base.permalink);
  });
});
