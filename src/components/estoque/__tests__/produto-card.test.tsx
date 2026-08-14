import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProdutoCard, CabecalhoProdutos, GRID_LINHA_PRODUTO } from '../produto-card';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/components/movimentos-estoque', () => ({
  MovimentosEstoque: () => <div>Movimentos de estoque</div>,
}));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchVariacoesProduto: () => Promise.resolve([]),
}));

const produtoMono: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20, qtdSkus: 1, skuUnico: '00000005',
  gtins: ['4005800241901'], codigos: ['00000005'], cores: ['incolor'],
};

const produto: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 40, qtdSkus: 2, skuUnico: null,
  gtins: ['4005800241901', '4005800241902'], codigos: ['00000005', '00000006'], cores: ['incolor', 'branco'],
};

function renderCard(produtoFixture = produto, onDarEntrada = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProdutoCard
        produto={produtoFixture} canais={[]}
        onDarEntrada={onDarEntrada}
      />
    </QueryClientProvider>,
  );
  return onDarEntrada;
}

/** O botão de entrada é rotulado com o produto (no mobile ele é só um ícone). */
const BOTAO_ENTRADA = /Dar entrada em Protetor Solar/;

describe('ProdutoCard', () => {
  it('expande por teclado e expõe aria-expanded', async () => {
    const user = userEvent.setup();
    renderCard();
    const botao = screen.getByRole('button', { name: /^Protetor Solar/ });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    botao.focus();
    await user.keyboard('{Enter}');
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });

  it('produto monovariação pré-seleciona SKU ao dar entrada', async () => {
    const user = userEvent.setup();
    const onDarEntrada = renderCard(produtoMono);
    await user.click(screen.getByRole('button', { name: BOTAO_ENTRADA }));
    expect(onDarEntrada).toHaveBeenCalledWith({ sku: '00000005', codigoPai: '00000004' });
  });

  // Guarda de regressão do defeito que originou o redesenho: tabela aninhada estoura a largura.
  it('o painel expandido não contém nenhuma <table>', async () => {
    const user = userEvent.setup();
    const { container } = render(<div />);
    renderCard();
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(container).toBeDefined();
  });

  it('produto multivariação não pré-seleciona SKU ao dar entrada', async () => {
    const user = userEvent.setup();
    const onDarEntrada = renderCard();
    await user.click(screen.getByRole('button', { name: BOTAO_ENTRADA }));
    expect(onDarEntrada).toHaveBeenCalledWith({ codigoPai: '00000004' });
  });

  // Remoção deliberada: `descricao_pai` é copy de marketing do anúncio (3 linhas por produto),
  // não informação de estoque. Era o maior bloco do painel e não respondia nenhuma pergunta
  // que o operador faz aqui. Se voltar a ser desejada, é um link para a Revisão, não um dump.
  it('o painel expandido não exibe a descrição de marketing do produto', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));
    expect(screen.queryByText('Descrição longa.')).not.toBeInTheDocument();
  });

  // Cabeçalho e linha usam o MESMO template de grid: se um mudar sem o outro, os rótulos
  // deixam de bater com as colunas e o alinhamento (o ponto do redesenho) se perde.
  it('cabeçalho de colunas usa o mesmo template de grid da linha', () => {
    const { container } = render(<CabecalhoProdutos />);
    expect(container.firstElementChild!.className).toContain(GRID_LINHA_PRODUTO);
  });

  // `sr-only` é `position:absolute`: um item assim não ocupa track e desliza todos os rótulos
  // seguintes uma coluna. A célula vazia da coluna de ação precisa continuar no fluxo.
  it('nenhuma célula do cabeçalho é sr-only (sairia do fluxo do grid)', () => {
    const { container } = render(<CabecalhoProdutos />);
    for (const celula of Array.from(container.firstElementChild!.children)) {
      expect(celula.className.split(/\s+/)).not.toContain('sr-only');
    }
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

  // ADR-0113: excluir é admin-only. A página não passa `onExcluir` para não-admin, e sem ele o
  // menu ⋮ não existe — é a única ação que mora lá dentro.
  it('menu de mais ações só aparece com onExcluir', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText(/Mais ações/)).not.toBeInTheDocument();

    const onExcluir = vi.fn();
    rerender(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} onExcluir={onExcluir} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByLabelText(/Mais ações/));
    await userEvent.click(await screen.findByText('Excluir produto'));
    expect(onExcluir).toHaveBeenCalledWith(produto);
  });

  // Medido em 375px: abrir espaço para um 3º botão derruba o texto do nome de 81px para 49px
  // ("Crem…"). O menu só existe de `md` para cima, e a track MOBILE do grid fica em 5.5rem.
  // jsdom não aplica media query — sem estas asserções a regra volta a quebrar em silêncio.
  it('menu de ações não aparece no mobile e a track mobile não cresce', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} onExcluir={vi.fn()} />
      </QueryClientProvider>,
    );
    const classes = screen.getByLabelText(/Mais ações/).className.split(/\s+/);
    expect(classes).toContain('hidden');
    expect(classes).toContain('md:flex');
    expect(GRID_LINHA_PRODUTO).toContain('grid-cols-[minmax(0,1fr)_3.25rem_5.5rem]');
  });

  it('produto publicado tem o item de excluir desabilitado', async () => {
    const publicado = { ...produto, mlItemId: 'MLB123' };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onExcluir = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={publicado} canais={['mercado_livre']} onDarEntrada={vi.fn()} onExcluir={onExcluir} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByLabelText(/Mais ações/));
    expect(await screen.findByText('Excluir produto')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/remova pela tela Publicados/i)).toBeInTheDocument();
  });
});
