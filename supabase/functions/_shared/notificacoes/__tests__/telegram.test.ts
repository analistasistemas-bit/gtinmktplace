import { describe, it, expect } from 'vitest';
import { montarMensagemModerados, montarMensagemLiberacao } from '../telegram';

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
