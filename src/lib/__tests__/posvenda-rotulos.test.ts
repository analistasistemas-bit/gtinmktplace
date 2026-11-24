import { describe, expect, it } from 'vitest';
import { partesNegrito, rotuloEtapa, rotuloQuer, rotuloReputacao, rotuloStatus, textoHistorico, ultimaMensagemParaResponder } from '../posvenda-rotulos';

describe('posvenda-rotulos', () => {
  it('comprador quer', () => {
    expect(rotuloQuer('return_product')).toBe('Devolver o produto');
    expect(rotuloQuer('product')).toBe('Receber o produto');
    expect(rotuloQuer('refund')).toBe('Receber o dinheiro de volta');
    expect(rotuloQuer('change_product')).toBe('Trocar o produto');
    expect(rotuloQuer('partial_refund')).toBe('Reembolso parcial');
    expect(rotuloQuer('xyz')).toBe('xyz');
    expect(rotuloQuer(null)).toBe('—');
  });
  it('etapa', () => {
    expect(rotuloEtapa('claim')).toBe('Reclamação (sem mediação)');
    expect(rotuloEtapa('dispute')).toBe('Mediação do Mercado Livre');
    expect(rotuloEtapa('recontact')).toBe('Recontato');
    expect(rotuloEtapa('none')).toBe('—');
    expect(rotuloEtapa(null)).toBe('—');
  });
  it('reputação', () => {
    expect(rotuloReputacao('not_affected')).toBe('Não afeta');
    expect(rotuloReputacao('affected')).toBe('Afeta sua reputação');
    expect(rotuloReputacao('x')).toBe('x');
    expect(rotuloReputacao(null)).toBe('—');
  });
  it('status', () => {
    expect(rotuloStatus('opened')).toBe('aberta');
    expect(rotuloStatus('closed')).toBe('encerrada');
    expect(rotuloStatus('x')).toBe('x');
  });
  it('linha de status do histórico', () => {
    expect(textoHistorico('Status da reclamação: dispute / opened')).toBe('Status: Mediação do Mercado Livre · aberta');
    expect(textoHistorico('Status da reclamação: claim')).toBe('Status: Reclamação (sem mediação)');
    expect(textoHistorico('Status da reclamação: closed')).toBe('Status: encerrada');
    expect(textoHistorico('Olá **você**')).toBe('Olá **você**');
  });
  it('negrito', () => {
    expect(partesNegrito('a **b** c\n**d**')).toEqual([
      { t: 'a ', b: false }, { t: 'b', b: true }, { t: ' c\n', b: false }, { t: 'd', b: true },
    ]);
    expect(partesNegrito('sem')).toEqual([{ t: 'sem', b: false }]);
  });

  it('última mensagem para responder: ignora status; some se a última é do vendedor', () => {
    const m = (autor: 'comprador' | 'vendedor' | 'ml', texto: string) => ({ autor, texto });
    const opcoes = m('ml', 'Escolha 1, 2 ou 3');
    const pergunta = m('ml', 'Qual percentual?');
    expect(ultimaMensagemParaResponder([opcoes, m('vendedor', '2.'), pergunta, m('ml', 'Status da reclamação: dispute / opened')])).toBe(pergunta);
    expect(ultimaMensagemParaResponder([opcoes, m('vendedor', '2.')])).toBeNull();
    expect(ultimaMensagemParaResponder([m('comprador', 'Oi')])?.texto).toBe('Oi');
    expect(ultimaMensagemParaResponder([])).toBeNull();
  });
});
