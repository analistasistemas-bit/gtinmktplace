import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VariacaoEstoqueLinha, CabecalhoVariacoes } from '../variacao-estoque-linha';
import type { VariacaoComSaldo } from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));

function variacao(over: Partial<VariacaoComSaldo> = {}): VariacaoComSaldo {
  return {
    codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901',
    estoque: 20, custo: 12, preco: 89.9, pesoGramas: 200,
    alturaCm: 10, larguraCm: 20, comprimentoCm: 30, imagemPath: null, mlPictureId: null, ...over,
  };
}

describe('VariacaoEstoqueLinha', () => {
  it('mostra SKU, cor, GTIN e dimensões', () => {
    render(<VariacaoEstoqueLinha variacao={variacao()} />);
    expect(screen.getByText('00000005')).toBeInTheDocument();
    expect(screen.getByText('incolor')).toBeInTheDocument();
    expect(screen.getByText('4005800241901')).toBeInTheDocument();
    expect(screen.getByText('200g · 10×20×30cm')).toBeInTheDocument();
  });

  it('saldo zero recebe aviso de sem estoque', () => {
    render(<VariacaoEstoqueLinha variacao={variacao({ estoque: 0 })} />);
    expect(screen.getByText('sem estoque')).toBeInTheDocument();
  });

  // Saldo negativo é bug de ledger, não "acabou o estoque": precisa de rótulo próprio.
  it('saldo negativo recebe rótulo de inconsistência', () => {
    render(<VariacaoEstoqueLinha variacao={variacao({ estoque: -3 })} />);
    expect(screen.getByText('saldo inconsistente')).toBeInTheDocument();
  });

  // Abaixo de lg as colunas de custo/preço somem e voltam como linha secundária: os dois
  // caminhos precisam existir, senão o dado desaparece no mobile.
  it('custo e preço aparecem na coluna e também na linha secundária do mobile', () => {
    render(<VariacaoEstoqueLinha variacao={variacao()} />);
    expect(screen.getAllByText(/R\$\s?12,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/custo R\$\s?12,00 · preço R\$\s?89,90/)).toBeInTheDocument();
  });

  it('custo ausente vira travessão, nunca R$ 0,00', () => {
    render(<VariacaoEstoqueLinha variacao={variacao({ custo: null })} />);
    expect(screen.getByText(/custo — · preço/)).toBeInTheDocument();
  });
});

describe('CabecalhoVariacoes', () => {
  // O alinhamento por grid depende do cabeçalho ter EXATAMENTE as mesmas 7 células da linha,
  // na mesma ordem — se divergir, os rótulos deixam de bater com as colunas.
  it('tem uma célula por coluna da linha, na mesma ordem', () => {
    const { container } = render(<CabecalhoVariacoes />);
    const celulas = Array.from(container.firstElementChild!.children).map((e) => e.textContent);
    expect(celulas).toEqual(['', 'SKU', 'GTIN', 'Peso e dimensões', 'Custo', 'Preço', 'Saldo']);
  });

  // Regressão real: a célula vazia da coluna da foto usava `sr-only`, que é `position:absolute`
  // e portanto NÃO ocupa track de grid — o cabeçalho inteiro deslizava uma coluna para a
  // esquerda e nenhum rótulo batia com a sua coluna. Contar células não pega isso; olhar a
  // classe, sim.
  it('nenhuma célula do cabeçalho é sr-only (sairia do fluxo do grid)', () => {
    const { container } = render(<CabecalhoVariacoes />);
    for (const celula of Array.from(container.firstElementChild!.children)) {
      expect(celula.className.split(/\s+/)).not.toContain('sr-only');
    }
  });
});
