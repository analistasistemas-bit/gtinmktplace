import { describe, it, expect } from 'vitest';
import { montarMensagemConfirmacaoFalhou, montarMensagemEstoqueZerado, montarMensagemTetoAnuncio, montarMensagemVoltaAoAr } from '../estoque';

const base = {
  produto: 'Sabonete Líquido Nivea 200ml',
  codigoPai: '00000028',
  permalink: 'https://produto.mercadolivre.com.br/MLB5040504553',
};

describe('montarMensagemConfirmacaoFalhou (ADR-0195)', () => {
  const divergentes = Array.from({ length: 12 }, (_, i) => ({ sku: `S${i}`, enviado: 10, observado: i === 0 ? null : 7 }));

  it('cita até 10 SKUs, com enviado e observado', () => {
    const m = montarMensagemConfirmacaoFalhou({ produto: 'Fita', codigoPai: '000', divergentes });
    expect(m).toContain('Fita');
    expect(m).toContain('12 SKU(s)');
    expect(m).toContain('• S0: enviado 10, no ML sem leitura');
    expect(m).toContain('• S9: enviado 10, no ML 7');
    expect(m).not.toContain('S10');
    expect(m).toContain('E mais 2 SKU(s).');
  });

  it('sem nome cai no código e sem excedente não fala em mais', () => {
    const m = montarMensagemConfirmacaoFalhou({ produto: null, codigoPai: '000', divergentes: divergentes.slice(0, 1) });
    expect(m).toContain('Mercado Livre: 000');
    expect(m).not.toContain('E mais');
  });
});

describe('montarMensagemEstoqueZerado', () => {
  it('produto inteiro zerado avisa que o anúncio foi pausado e como voltar', () => {
    const m = montarMensagemEstoqueZerado({
      ...base,
      zeradas: [{ codigo: '00000029', nome: null, cor: null }],
      produtoInteiroZerado: true,
    });
    expect(m).toContain('Anúncio pausado no Mercado Livre');
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
    expect(m).not.toContain('\n\n\n');
    expect(m.split('\n\n').every((b) => b.trim() !== '')).toBe(true);
  });
});

describe('montarMensagemVoltaAoAr', () => {
  it('confirma a reativação e leva ao anúncio', () => {
    const m = montarMensagemVoltaAoAr(base);
    expect(m).toContain('Voltou ao ar');
    expect(m).toContain(base.produto);
    expect(m).toContain(base.permalink);
  });
});

describe('montarMensagemTetoAnuncio (ADR-0195)', () => {
  it('cita produto, anúncio e quantas cores aparecem com menos estoque', () => {
    expect(montarMensagemTetoAnuncio({ codigoPai: '02835002', itemExternoId: 'MLB1', capados: 3 })).toBe(
      '📦 Anúncio acima do limite do Mercado Livre: produto 02835002, anúncio MLB1.\n'
      + '3 cor(es) aparecem com menos estoque no anúncio. O saldo real segue no PubliAI.',
    );
  });
});
