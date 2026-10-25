import { describe, it, expect } from 'vitest';
import {
  montarMensagemModerados,
  montarMensagemLiberacao,
  montarMensagemNovaVenda,
  montarMensagemNovaPergunta,
  montarMensagemNovaDevolucao,
} from '../telegram';

describe('montarMensagemModerados', () => {
  it('monta a mensagem com título, motivo traduzido e link', () => {
    const msg = montarMensagemModerados([
      { ml_item_id: 'MLB1', titulo: 'Alfinete N.04', motivo: 'forbidden', permalink: 'https://x/MLB1' },
    ]);
    expect(msg).toContain('1 anúncio moderado');
    expect(msg).toContain('Alfinete N.04');
    expect(msg).toContain('Proibido pelo ML');
    expect(msg).toContain('https://x/MLB1');
  });
  it('plural na contagem', () => {
    const msg = montarMensagemModerados([
      { ml_item_id: 'A', titulo: null, motivo: 'forbidden', permalink: null },
      { ml_item_id: 'B', titulo: null, motivo: 'waiting_for_patch', permalink: null },
    ]);
    expect(msg).toContain('2 anúncios moderados');
  });
});

describe('montarMensagemLiberacao', () => {
  it('contém o total formatado e a contagem no plural', () => {
    const msg = montarMensagemLiberacao(364.46, 3, 'BRL');
    expect(msg).toContain('R$ 364,46');
    expect(msg).toContain('Vendas: 3');
  });
  it('usa singular quando n=1', () => {
    const msg = montarMensagemLiberacao(100, 1, 'BRL');
    expect(msg).toContain('Vendas: 1');
    expect(msg).toContain('dessa venda');
    expect(msg).not.toContain('dessas vendas');
  });
});

describe('montarMensagemNovaVenda (link ML)', () => {
  const base = { comprador: 'Maria', itens: [], total: 10, moeda: 'BRL' };
  it('linka a venda avulsa pelo order_id', () => {
    const msg = montarMensagemNovaVenda({ ...base, order_id: 123 });
    expect(msg).toContain('https://www.mercadolivre.com.br/vendas/123/detalhe');
  });
  // `/vendas/pacote/{id}/detalhe` devolve 301 para /vendas/lista no ML (medido em 15/09/2026), e
  // `/vendas/{id}/detalhe` aceita pack ou order. Com pack, linkar o pack abre o pacote inteiro.
  it('total null (cupom não confirmado no MP) sai sem valor', () => {
    const msg = montarMensagemNovaVenda({ ...base, order_id: 123, total: null });
    expect(msg.split('\n')[0]).toBe('💰 Nova venda');
    expect(msg).toContain('Comprador: Maria');
  });
  it('linka o pack pela rota de venda quando há pack_id', () => {
    const msg = montarMensagemNovaVenda({ ...base, order_id: 123, pack_id: 456 });
    expect(msg).toContain('https://www.mercadolivre.com.br/vendas/456/detalhe');
    expect(msg).not.toContain('/vendas/pacote/');
  });
  // Regressão: o texto mostrava o order_id e o ML exibe o pack (#2000015659382505 × 2000019122247830).
  it('número do pedido é o pack_id quando há (o mesmo que o ML exibe)', () => {
    const msg = montarMensagemNovaVenda({ ...base, order_id: 123, pack_id: 456 });
    expect(msg).toContain('Pedido 456');
    expect(msg).not.toContain('Pedido 123');
  });
});

describe('montarMensagemNovaPergunta (link ML)', () => {
  it('linka a caixa de perguntas do vendedor, não o anúncio', () => {
    const msg = montarMensagemNovaPergunta({ question_id: 1, texto: 'oi', item_titulo: 'Prod' });
    expect(msg).toContain('https://www.mercadolivre.com.br/perguntas/vendedor');
    expect(msg).not.toContain('produto.mercadolivre.com.br');
  });
});

describe('montarMensagemNovaDevolucao (link ML)', () => {
  it('número do pedido é o pack_id quando há', () => {
    const msg = montarMensagemNovaDevolucao({ claim_id: 789, order_id: 1, pack_id: 2, tipo: 'mediations', motivo: null, valor: null, moeda: 'BRL' });
    expect(msg).toContain('Pedido: 2');
  });
  it('linka a reclamação específica quando tipo != returns', () => {
    const msg = montarMensagemNovaDevolucao({ claim_id: 789, order_id: 1, tipo: 'mediations', motivo: null, valor: null, moeda: 'BRL' });
    expect(msg).toContain('https://www.mercadolivre.com.br/vendas/reclamacoes/vendedor/789');
  });
  it('linka a lista filtrada quando tipo é returns', () => {
    const msg = montarMensagemNovaDevolucao({ claim_id: 789, order_id: 1, tipo: 'returns', motivo: null, valor: null, moeda: 'BRL' });
    expect(msg).toContain('post-purchase/post-sales?main.filter=returns');
    expect(msg).not.toContain('reclamacoes/vendedor/789');
  });
});
