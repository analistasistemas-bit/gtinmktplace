import { describe, it, expect } from 'vitest';
import { montarMensagemCatalogoNoMatch } from '../telegram';

describe('montarMensagemCatalogoNoMatch', () => {
  it('inclui título, a cor afetada, o passo manual e o link da página de catálogo', () => {
    const msg = montarMensagemCatalogoNoMatch({
      ml_item_id: 'MLB6901096672',
      titulo: 'Linha Setta Xik Tex 120',
      cores: ['Preto'],
    });
    expect(msg).toContain('Linha Setta Xik Tex 120');
    expect(msg).toContain('Preto');
    expect(msg).toContain('Não encontro minha variação');
    expect(msg).toContain('https://www.mercadolivre.com.br/produzir/catalogo/MLB6901096672');
  });

  it('lista múltiplas cores afetadas', () => {
    const msg = montarMensagemCatalogoNoMatch({
      ml_item_id: 'MLB1',
      titulo: 'Linha X',
      cores: ['Preto', 'Vermelho'],
    });
    expect(msg).toContain('Preto');
    expect(msg).toContain('Vermelho');
  });

  it('usa o ml_item_id como fallback quando não há título', () => {
    const msg = montarMensagemCatalogoNoMatch({
      ml_item_id: 'MLB1',
      titulo: null,
      cores: ['Preto'],
    });
    expect(msg).toContain('MLB1');
  });

  it('sinaliza o risco de o anúncio ser pausado se nada for feito', () => {
    const msg = montarMensagemCatalogoNoMatch({
      ml_item_id: 'MLB1',
      titulo: 'Linha X',
      cores: ['Preto'],
    });
    // menciona catálogo e a consequência (pausar/inativar) para o operador entender a urgência
    expect(msg.toLowerCase()).toMatch(/catálogo|catalogo/);
    expect(msg.toLowerCase()).toMatch(/pausa|inativ/);
  });

  it('descreve sem variation id como falha estrutural, sem alegar múltiplas tentativas', () => {
    const msg = montarMensagemCatalogoNoMatch({
      ml_item_id: 'MLB1',
      titulo: 'Linha X',
      cores: ['Preto'],
      motivo: 'sem_variation_id',
    });
    expect(msg).toContain('não tem identificador de variação');
    expect(msg).not.toContain('múltiplas tentativas');
  });
});
