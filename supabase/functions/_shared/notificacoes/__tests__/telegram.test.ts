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
    expect(msg).toContain('3 vendas');
  });
  it('usa singular quando n=1', () => {
    const msg = montarMensagemLiberacao(100, 1, 'BRL');
    expect(msg).toContain('1 venda');
    expect(msg).not.toContain('1 vendas');
  });
});

describe('montarMensagemNovaVenda (link ML)', () => {
  const base = { comprador: 'Maria', itens: [], total: 10, moeda: 'BRL' };
  it('linka a venda avulsa pelo order_id', () => {
    const msg = montarMensagemNovaVenda({ ...base, order_id: 123 });
    expect(msg).toContain('https://www.mercadolivre.com.br/vendas/123/detalhe');
  });
  it('linka o pacote quando há pack_id', () => {
    const msg = montarMensagemNovaVenda({ ...base, order_id: 123, pack_id: 456 });
    expect(msg).toContain('https://www.mercadolivre.com.br/vendas/pacote/456/detalhe');
    expect(msg).not.toContain('/vendas/123/detalhe');
  });
});

describe('montarMensagemNovaPergunta (link ML)', () => {
  it('linka o anúncio quando há item_id', () => {
    const msg = montarMensagemNovaPergunta({ question_id: 1, texto: 'oi', item_titulo: 'Prod', item_id: 'MLB123' });
    expect(msg).toContain('https://produto.mercadolivre.com.br/MLB-123');
  });
  it('sem item_id não gera link', () => {
    const msg = montarMensagemNovaPergunta({ question_id: 1, texto: 'oi', item_titulo: 'Prod', item_id: null });
    expect(msg).not.toContain('produto.mercadolivre.com.br');
  });
});

describe('montarMensagemNovaDevolucao (link ML)', () => {
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
