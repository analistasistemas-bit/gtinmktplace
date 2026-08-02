import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProdutoCard } from '../produto-card';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/components/movimentos-estoque', () => ({
  MovimentosEstoque: () => <div>Movimentos de estoque</div>,
}));

const produtoMono: ProdutoComSaldo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20,
  variacoes: [
    {
      codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901', estoque: 20,
      custo: 12, preco: 89.9, pesoGramas: null, alturaCm: null, larguraCm: null,
      comprimentoCm: null, imagemPath: null,
    },
  ],
};

const produto: ProdutoComSaldo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 40,
  variacoes: [
    {
      codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901', estoque: 20,
      custo: 12, preco: 89.9, pesoGramas: null, alturaCm: null, larguraCm: null,
      comprimentoCm: null, imagemPath: null,
    },
    {
      codigo: '00000006', nome: null, cor: 'branco', gtin: '4005800241902', estoque: 20,
      custo: 12, preco: 89.9, pesoGramas: null, alturaCm: null, larguraCm: null,
      comprimentoCm: null, imagemPath: null,
    },
  ],
};

function renderCard(produtoFixture = produto, onDarEntrada = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProdutoCard produto={produtoFixture} canais={[]} onDarEntrada={onDarEntrada} />
    </QueryClientProvider>,
  );
  return onDarEntrada;
}

describe('ProdutoCard', () => {
  it('expande por teclado e expõe aria-expanded', async () => {
    const user = userEvent.setup();
    renderCard();
    const botao = screen.getByRole('button', { name: /Protetor Solar/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    botao.focus();
    await user.keyboard('{Enter}');
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });

  it('produto monovariação pré-seleciona SKU ao dar entrada', async () => {
    const user = userEvent.setup();
    const onDarEntrada = renderCard(produtoMono);
    await user.click(screen.getByRole('button', { name: 'Dar entrada' }));
    expect(onDarEntrada).toHaveBeenCalledWith({ sku: '00000005', codigoPai: '00000004' });
  });

  // Guarda de regressão do defeito que originou o redesenho: tabela aninhada estoura a largura.
  it('o painel expandido não contém nenhuma <table>', async () => {
    const user = userEvent.setup();
    const { container } = render(<div />);
    renderCard();
    await user.click(screen.getByRole('button', { name: /Protetor Solar/ }));
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(container).toBeDefined();
  });

  it('produto multivariação não pré-seleciona SKU ao dar entrada', async () => {
    const user = userEvent.setup();
    const onDarEntrada = renderCard();
    await user.click(screen.getByRole('button', { name: 'Dar entrada' }));
    expect(onDarEntrada).toHaveBeenCalledWith({ codigoPai: '00000004' });
  });

  // M-3: garante que o card exibe o badge quando a prop `canais` inclui o canal — a correção
  // real (incluir 'mercado_livre' por ml_item_id mesmo sem espelho) mora em `canaisEfetivos`
  // (produtos-saldo-filtro.ts), que decide essa prop; aqui só confirma que o card a respeita.
  it('mostra o badge do canal recebido via prop', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={['mercado_livre']} onDarEntrada={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Mercado Livre')).toBeInTheDocument();
  });

  // M-5: saldo positivo não podia sumir inteiro em telas estreitas — só o pill (que só
  // aparece com saldo <= 0) sobrava no mobile, escondendo o número atrás de `hidden sm:block`.
  // O menor breakpoint do Tailwind (sm, 640px) já é maior que 375px: qualquer `hidden` na
  // cadeia de ancestrais — mesmo com `sm:block` — esconde o saldo no celular.
  it('saldo positivo não fica dentro de container escondido no mobile', () => {
    renderCard();
    for (let el: HTMLElement | null = screen.getByText('40'); el; el = el.parentElement) {
      expect(el.className.split(/\s+/)).not.toContain('hidden');
    }
  });
});
