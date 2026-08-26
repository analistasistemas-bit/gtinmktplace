import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProdutoCard, CabecalhoProdutos, GRID_LINHA_PRODUTO, VARIACOES_VIRTUAL_THRESHOLD, VARIACAO_ROW_ESTIMATE_PX } from '../produto-card';
import { QK } from '@/lib/queries';
import type { ProdutoEstoqueResumo, VariacaoComSaldo } from '@/lib/produtos-saldo';
import * as produtosSaldo from '@/lib/produtos-saldo';

vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));

/** Status ao vivo dos anúncios — mutável por teste (o hook real chama a edge status-publicados). */
let statusItens: Array<{ ml_item_id: string; preco: number | null }> = [];
vi.mock('@/hooks/useStatusPublicados', () => ({
  useStatusPublicados: () => ({ data: { itens: statusItens } }),
}));
vi.mock('@/components/movimentos-estoque', () => ({
  MovimentosEstoque: () => <div>Movimentos de estoque</div>,
}));

const fetchVariacoesProdutoMock = vi.fn<typeof produtosSaldo.fetchVariacoesProduto>();
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchVariacoesProduto: (...args: Parameters<typeof produtosSaldo.fetchVariacoesProduto>) =>
    fetchVariacoesProdutoMock(...args),
}));

/** Gera N variações mock para testes de virtualização. */
function mockVariacoes(n: number, codigoBase = 1001): VariacaoComSaldo[] {
  return Array.from({ length: n }, (_, i) => ({
    codigo: `0000${String(codigoBase + i).padStart(4, '0')}`,
    nome: `Var ${i + 1}`,
    cor: 'incolor',
    gtin: `40058002419${String(i).padStart(2, '0')}`,
    estoque: i,
    custo: 10 + i,
    preco: 20 + i,
    pesoGramas: 100,
    alturaCm: 10,
    larguraCm: 10,
    comprimentoCm: 10,
    imagemPath: null,
    mlPictureId: null,
    mlItemId: null,
  }));
}

beforeEach(() => {
  fetchVariacoesProdutoMock.mockReset();
  fetchVariacoesProdutoMock.mockResolvedValue([]);
  statusItens = [];
});

const produtoMono: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20, qtdSkus: 1, skuUnico: '00000005',
  gtins: ['4005800241901'], codigos: ['00000005'], cores: ['incolor'], nomes: [],
};

const produto: ProdutoEstoqueResumo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: 'Descrição longa.',
  capaStoragePath: null, capaMlPictureId: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 40, qtdSkus: 2, skuUnico: null,
  gtins: ['4005800241901', '4005800241902'], codigos: ['00000005', '00000006'], cores: ['incolor', 'branco'],
  nomes: [],
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

  // ADR-0135 D-9 (fix round 1, I1): `fiscalPendente` é prop da página (`produtoFiscalPendente`,
  // depende do regime tributário), não campo do resumo — ação "Preencher fiscal" só aparece com
  // fiscalPendente E familiaId E a prop onPreencherFiscal, as três precisam bater.
  it('ação "Preencher fiscal" só aparece quando fiscalPendente, familiaId e a prop estão presentes', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onPreencherFiscal = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} onPreencherFiscal={onPreencherFiscal} />
      </QueryClientProvider>,
    );
    // produto fixture não tem familiaId, e fiscalPendente não foi passado — botão não aparece.
    expect(screen.queryByLabelText(/Preencher fiscal/)).not.toBeInTheDocument();

    const pendente = { ...produto, familiaId: 'fam-1' };
    rerender(
      <QueryClientProvider client={qc}>
        <ProdutoCard
          produto={pendente} canais={[]} onDarEntrada={vi.fn()}
          onPreencherFiscal={onPreencherFiscal} fiscalPendente
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText(/Preencher fiscal/)).toBeInTheDocument();

    // Sem a prop onPreencherFiscal, mesmo pendente, o botão não aparece.
    rerender(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={pendente} canais={[]} onDarEntrada={vi.fn()} fiscalPendente />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText(/Preencher fiscal/)).not.toBeInTheDocument();
  });

  it('clicar em "Preencher fiscal" chama a prop com o produto', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onPreencherFiscal = vi.fn();
    const pendente = { ...produto, familiaId: 'fam-1' };
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard
          produto={pendente} canais={[]} onDarEntrada={vi.fn()}
          onPreencherFiscal={onPreencherFiscal} fiscalPendente
        />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByLabelText(/Preencher fiscal/));
    expect(onPreencherFiscal).toHaveBeenCalledWith(pendente);
  });

  it('virtualiza a lista quando há mais variações que o limiar', async () => {
    const n = VARIACOES_VIRTUAL_THRESHOLD + 1;
    const variacoes = mockVariacoes(n);
    fetchVariacoesProdutoMock.mockResolvedValue(variacoes);

    const user = userEvent.setup();
    const produtoMany = { ...produto, qtdSkus: n };
    renderCard(produtoMany);
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => {
      expect(screen.getByTestId('variacoes-virtual-scroll')).toBeInTheDocument();
    });

    const inner = screen.getByTestId('variacoes-virtual-inner');
    expect(Number.parseInt(inner.style.height, 10)).toBe(n * VARIACAO_ROW_ESTIMATE_PX);

    // jsdom não layouta o scroller — o virtualizer pode montar 0 linhas aqui, mas NUNCA monta
    // as N de um map completo (contraste com o teste de 50 abaixo). Em browser real monta ~17.
    const codigosNoDom = variacoes.filter((v) => screen.queryByText(v.codigo));
    expect(codigosNoDom.length).toBeLessThan(n);

    expect(screen.getByRole('region', { name: 'Variações de Protetor Solar' })).toHaveAttribute('tabindex', '0');
  });

  it('não virtualiza no limiar exato (50 variações) — todas no DOM', async () => {
    const variacoes = mockVariacoes(VARIACOES_VIRTUAL_THRESHOLD);
    fetchVariacoesProdutoMock.mockResolvedValue(variacoes);

    const user = userEvent.setup();
    renderCard({ ...produto, qtdSkus: VARIACOES_VIRTUAL_THRESHOLD });
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => {
      expect(screen.getByText(variacoes[0]!.codigo)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('variacoes-virtual-scroll')).not.toBeInTheDocument();
    expect(variacoes.filter((v) => screen.queryByText(v.codigo)).length).toBe(VARIACOES_VIRTUAL_THRESHOLD);
  });

  it('não virtualiza quando há poucas variações — todas visíveis no DOM', async () => {
    const variacoes = mockVariacoes(5);
    fetchVariacoesProdutoMock.mockResolvedValue(variacoes);

    const user = userEvent.setup();
    const produtoFew = { ...produto, qtdSkus: 5 };
    renderCard(produtoFew);
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => {
      for (const v of variacoes) {
        expect(screen.getByText(v.codigo)).toBeInTheDocument();
      }
    });

    expect(screen.queryByTestId('variacoes-virtual-scroll')).not.toBeInTheDocument();
  });

  // Fiação do preço vivo: cada SKU casa com o SEU anúncio (User Products e split têm um item ML
  // por SKU), não com o item da família. Sem isso, todas as cores exibiriam o mesmo preço.
  it('cada variação mostra o preço vivo do anúncio que vende aquele SKU', async () => {
    fetchVariacoesProdutoMock.mockResolvedValue([
      { ...mockVariacoes(1)[0]!, codigo: '00000005', preco: 28.99, mlItemId: 'MLB1' },
      { ...mockVariacoes(1)[0]!, codigo: '00000006', preco: 28.99, mlItemId: 'MLB2' },
    ]);
    statusItens = [
      { ml_item_id: 'MLB1', preco: 39.9 },
      { ml_item_id: 'MLB2', preco: 44.5 },
    ];

    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => expect(screen.getAllByText(/R\$\s?39,90/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/R\$\s?44,50/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/local R\$\s?28,99/).length).toBe(4); // 2 linhas × (coluna + mobile)
  });

  // SKU sem anúncio (ou status ainda não carregado) mantém o preço local — nunca vazio.
  // ADR-0129 D-7: item novo do menu "⋮" — aparece SÓ com onAdicionarVariacao (a página só passa
  // a prop para admin), independente de onExcluir estar presente ou não.
  it('item Adicionar variação só aparece com onAdicionarVariacao definido', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText(/Mais ações/)).not.toBeInTheDocument();

    const onAdicionarVariacao = vi.fn();
    rerender(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} onAdicionarVariacao={onAdicionarVariacao} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByLabelText(/Mais ações/));
    const publicado = { ...produto, mlItemId: 'MLB1' };
    rerender(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={publicado} canais={[]} onDarEntrada={vi.fn()} onAdicionarVariacao={onAdicionarVariacao} />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByText('Adicionar variação'));
    expect(onAdicionarVariacao).toHaveBeenCalledWith(publicado);
  });

  it('item Adicionar variação fica desabilitado quando mlItemId é null (não publicado)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} onAdicionarVariacao={vi.fn()} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByLabelText(/Mais ações/));
    expect(await screen.findByText('Adicionar variação')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/Disponível após publicar no ML/i)).toBeInTheDocument();
  });

  it('badge "Atualizando…" aparece sob o código com statusUpdate=atualizando', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} statusUpdate="atualizando" />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Atualizando…')).toBeInTheDocument();
  });

  it('badge "Erro na última atualização" aparece sob o código com statusUpdate=erro', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} statusUpdate="erro" />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Erro na última atualização')).toBeInTheDocument();
  });

  it('sem statusUpdate, nenhum badge de atualização aparece', () => {
    renderCard();
    expect(screen.queryByText('Atualizando…')).not.toBeInTheDocument();
    expect(screen.queryByText('Erro na última atualização')).not.toBeInTheDocument();
  });

  // Pedido do Diego (2026-08-21): badge por linha nas variações recém-adicionadas — a linha
  // '00000006' está marcada, '00000005' não; só a marcada pode ganhar badge.
  it('linha marcada em QK.variacoesRecemAdicionadas mostra "Publicado" quando não há statusUpdate', async () => {
    fetchVariacoesProdutoMock.mockResolvedValue([
      mockVariacoes(1, 5)[0]!, mockVariacoes(1, 6)[0]!,
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QK.variacoesRecemAdicionadas(produto.codigoPai), ['00000006']);
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => expect(screen.getByText('Publicado')).toBeInTheDocument());
    expect(screen.getAllByText('Publicado')).toHaveLength(1);
  });

  it('linha marcada + statusUpdate="atualizando" mostra "Publicando…"', async () => {
    fetchVariacoesProdutoMock.mockResolvedValue([mockVariacoes(1, 6)[0]!]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QK.variacoesRecemAdicionadas(produto.codigoPai), ['00000006']);
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} statusUpdate="atualizando" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => expect(screen.getByText('Publicando…')).toBeInTheDocument());
  });

  it('linha marcada + statusUpdate="erro" mostra "Erro" na linha', async () => {
    fetchVariacoesProdutoMock.mockResolvedValue([mockVariacoes(1, 6)[0]!]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(QK.variacoesRecemAdicionadas(produto.codigoPai), ['00000006']);
    render(
      <QueryClientProvider client={qc}>
        <ProdutoCard produto={produto} canais={[]} onDarEntrada={vi.fn()} statusUpdate="erro" />
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    // Badge da LINHA ("Erro", exato) — diferente do badge do produto ("Erro na última
    // atualização", já coberto no teste acima), então não colide com `getByText`.
    await waitFor(() => expect(screen.getByText('Erro')).toBeInTheDocument());
  });

  it('variação sem anúncio no mapa segue mostrando o preço local', async () => {
    fetchVariacoesProdutoMock.mockResolvedValue([
      { ...mockVariacoes(1)[0]!, codigo: '00000005', preco: 28.99, mlItemId: null },
    ]);
    statusItens = [{ ml_item_id: 'MLB1', preco: 39.9 }];

    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /^Protetor Solar/ }));

    await waitFor(() => expect(screen.getAllByText(/R\$\s?28,99/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/R\$\s?39,90/)).not.toBeInTheDocument();
    expect(screen.queryByText(/local R\$/)).not.toBeInTheDocument();
  });
});
