import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogDetalhe } from '../dialog-detalhe';
import type { PulseOferta, PulseProduto, PulseVendedor } from '@/lib/pulse';

const detalhe = vi.hoisted(() => ({
  ofertas: [] as PulseOferta[],
  ofertasAtuais: [] as PulseOferta[],
  vendedores: [] as PulseVendedor[],
}));

const contextoMargem = vi.hoisted(() => ({
  valor: { custo: null as number | null, aliquotaPct: null as number | null },
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => (
      queryKey[1] === 'contexto-margem'
        ? { data: contextoMargem.valor, isLoading: false }
        : { data: detalhe, isLoading: false }
    ),
  };
});

vi.mock('@/lib/pulse', () => ({
  fetchContextoMargem: vi.fn(),
  fetchPulseDetalhe: vi.fn(),
}));

vi.mock('@/components/pulse/dialog-reprecificar', () => ({
  DialogReprecificar: () => null,
}));

const produtoBase: PulseProduto = {
  id: 'produto-1',
  catalog_product_id: 'MLB123456',
  codigo_pai: null,
  titulo: 'Fórmula Infantil Aptamil Premium 1800g Danone',
  gtin: '0007891234567',
  origem: 'auto',
  status: 'ativo',
  catalogo_status: 'vinculado',
  ptw_status: null,
  ptw_preco_sugerido: null,
  ptw_aplicavel: null,
  ptw_custos: null,
  ultimo_snapshot_em: null,
  meu_preco: 81.99,
  meu_preco_em: null,
  anuncio_status: 'active',
  anuncio_sub_status: [],
  anuncio_status_em: null,
  comissao_pct: null,
  comissao_fixa: null,
  comissao_preco: null,
  comissao_em: null,
};

const oferta = (overrides: Partial<PulseOferta>): PulseOferta => ({
  item_id: 'MLB-OFFER',
  seller_id: 1,
  preco: 36,
  tier: 'gold_special',
  frete_gratis: false,
  full_ml: false,
  loja_oficial: false,
  ativo: true,
  dia: '2026-08-20',
  permalink: null,
  visitas_30d: null,
  visitas_30d_em: null,
  ...overrides,
});

const vendedor = (seller_id: number, nickname: string): PulseVendedor => ({
  seller_id,
  nickname,
  power_seller: null,
  nivel: null,
  transactions_total: 0,
  dia: '2026-08-20',
  uf: 'RJ',
  reputacao_detalhe: null,
  perfil_coletado_em: null,
});

function renderDetalhe(produto: PulseProduto = produtoBase) {
  return render(<DialogDetalhe produto={produto} onFechar={vi.fn()} />);
}

/** Produto com os QUATRO insumos da margem — custo 30, alíquota 8%, comissão 14% + 0 fixo lida
 *  em R$ 100 (sem "estimativa"), frete 5 — a R$ 100. Sobra: 100 − 14 − 5 − 8 − 30 = 43,00 (43.0%). */
function renderDetalheComMargem() {
  contextoMargem.valor = { custo: 30, aliquotaPct: 8 };
  return renderDetalhe({
    ...produtoBase, codigo_pai: 'APTAMIL-1', meu_preco: 100,
    comissao_pct: 14, comissao_fixa: 0, comissao_preco: 100,
    ptw_custos: { comissao: null, frete: 5 },
  });
}

/** Uma oferta RELEVANTE (ADR-0130: ≥10 transações, visitas 30d ≠ 0, reputação verde) de "LOJA UM",
 *  MercadoLíder Platinum, sem `reputacao_detalhe` (o <details> não abre; o rótulo sai em <span>). */
function renderDetalheComOfertas() {
  detalhe.ofertasAtuais = [oferta({ item_id: 'MLB-UM', seller_id: 7, preco: 70.19, visitas_30d: 120 })];
  detalhe.vendedores = [{
    ...vendedor(7, 'LOJA UM'), transactions_total: 500, nivel: '5_green', power_seller: 'platinum',
  }];
  return renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1' });
}

beforeEach(() => {
  detalhe.ofertas = [];
  detalhe.ofertasAtuais = [
    oferta({
      item_id: 'MLB-OFFER-36',
      seller_id: 1,
      permalink: 'https://produto.mercadolivre.com.br/MLB-OFFER-36',
    }),
    oferta({ item_id: 'MLB-OFFER-70', seller_id: 2, preco: 70.19 }),
  ];
  detalhe.vendedores = [
    vendedor(1, 'SOUZABRUNA20230210001211'),
    {
      ...vendedor(2, 'OUTRO-VENDEDOR'), transactions_total: 10, nivel: '3_yellow', power_seller: 'gold',
      reputacao_detalhe: {
        transactions: { period: '60 days', total: 10, ratings: { positive: 0.98 } },
        metrics: {
          claims: { period: '60 days', rate: 0.01, value: 1 },
          delayed_handling_time: { period: '60 days', rate: 0.02, value: 2 },
          cancellations: { period: '60 days', rate: 0.03, value: 3 },
        },
      },
    },
  ];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  contextoMargem.valor = { custo: null, aliquotaPct: null };
});

describe('DialogDetalhe — links de ofertas do Mercado Livre', () => {
  it('mostra busca ampla por GTIN, com segurança e sem rota /p/', () => {
    renderDetalhe();

    const link = screen.getByRole('link', { name: /Buscar anúncios no Mercado Livre/i });
    expect(link).toHaveAttribute('href', 'https://lista.mercadolivre.com.br/0007891234567');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.getAttribute('href')).not.toContain('/p/');
  });

  it('não mostra link de busca quando faltam GTIN e título', () => {
    renderDetalhe({ ...produtoBase, gtin: null, titulo: null });

    const linksDeBusca = screen.queryAllByRole('link').filter((link) => (
      link.getAttribute('href')?.startsWith('https://lista.mercadolivre.com.br/')
    ));
    expect(linksDeBusca).toHaveLength(0);
  });

  it('abre o permalink individual e identifica oferta sem permalink', () => {
    renderDetalhe();
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));

    expect(screen.getByText('Oferta')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Abrir oferta/i });
    expect(link).toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-OFFER-36');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Indisponível')).toBeInTheDocument();
  });

  it('usa largura desktop ampliada para manter a coluna Oferta visível', () => {
    renderDetalhe();

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-7xl');
  });
});

describe('DialogDetalhe — concorrentes relevantes', () => {
  it('usa o menor relevante e permite auditar todas as ofertas observadas', () => {
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    const referencia = screen.getByText('Menor concorrente relevante').parentElement!;
    expect(referencia).toHaveTextContent(/R\$\s*70,19/);
    expect(screen.getByText(/Menor oferta observada:\s*R\$\s*36,00/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /1 relevante de 2 observadas/ })).toBeInTheDocument();
    expect(screen.queryByText('SOUZABRUNA20230210001211')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Filtro de concorrentes' })).toContainElement(
      screen.getByRole('button', { name: 'Relevantes' }),
    );
    expect(screen.getByRole('button', { name: 'Relevantes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('+17% mais caro')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(referencia).toHaveTextContent(/R\$\s*70,19/);
    expect(screen.getByRole('heading', { name: /1 relevante de 2 observadas/ })).toBeInTheDocument();
    expect(screen.getByText('+17% mais caro')).toBeInTheDocument();
    expect(screen.getByText('SOUZABRUNA20230210001211')).toBeInTheDocument();
    expect(screen.getByText('Fora da referência')).toBeInTheDocument();
    expect(screen.getByText('Poucas transações')).toBeInTheDocument();
    expect(screen.getByText(/MercadoLíder Gold/)).toBeInTheDocument();
    expect(screen.getByText('Reputação amarela')).toBeInTheDocument();
  });

  it('expõe os detalhes da conta em disclosure acionável por teclado', async () => {
    const user = userEvent.setup();
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    const reputacao = screen.getByText('Reputação amarela');
    const disclosure = reputacao.closest('details');
    expect(disclosure).not.toBeNull();
    const resumo = reputacao.closest('summary');
    expect(resumo).not.toBeNull();
    if (!resumo) throw new Error('Resumo de reputação ausente');
    expect(resumo).toHaveAccessibleName('Reputação amarela. Vendedor: OUTRO-VENDEDOR. Ver detalhes da conta');
    expect(disclosure).not.toHaveAttribute('open');
    resumo.focus();
    expect(resumo).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(disclosure).toHaveAttribute('open');
    const reclamacoes = within(disclosure!).getByText('Reclamações').parentElement!;
    expect(reclamacoes).toHaveTextContent(/Período\s*60 days/);
    expect(reclamacoes).toHaveTextContent(/Taxa\s*1\.0%/);
    expect(reclamacoes).toHaveTextContent(/Quantidade\s*1/);
    const atrasos = within(disclosure!).getByText('Atrasos').parentElement!;
    expect(atrasos).toHaveTextContent(/Período\s*60 days/);
    expect(atrasos).toHaveTextContent(/Taxa\s*2\.0%/);
    expect(atrasos).toHaveTextContent(/Quantidade\s*2/);
    const cancelamentos = within(disclosure!).getByText('Cancelamentos').parentElement!;
    expect(cancelamentos).toHaveTextContent(/Período\s*60 days/);
    expect(cancelamentos).toHaveTextContent(/Taxa\s*3\.0%/);
    expect(cancelamentos).toHaveTextContent(/Quantidade\s*3/);

    await user.keyboard('{Enter}');
    expect(disclosure).not.toHaveAttribute('open');
  });

  it('mostra ofertas em observação apenas ao incluir todas', () => {
    detalhe.vendedores[0] = { ...detalhe.vendedores[0], transactions_total: null };
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    expect(screen.queryByText('Em observação')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByText('Em observação')).toBeInTheDocument();
    expect(screen.getByText('Dados insuficientes')).toBeInTheDocument();
  });

  it('usa observada no singular quando há uma única oferta', () => {
    detalhe.ofertasAtuais = [oferta({ item_id: 'MLB-OFFER-70', seller_id: 2, preco: 70.19 })];
    detalhe.vendedores = [detalhe.vendedores[1]];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    expect(screen.getByRole('heading', { name: /1 relevante de 1 observada\)/ })).toBeInTheDocument();
  });

  it('não compara preço quando nenhuma oferta é relevante', () => {
    detalhe.vendedores = detalhe.vendedores.map((v) => ({ ...v, transactions_total: 0 }));
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    expect(screen.getByText('Sem concorrente relevante')).toBeInTheDocument();
    expect(screen.getByText(/Menor oferta observada:\s*R\$\s*36,00/)).toBeInTheDocument();
    expect(screen.getByText('Sua posição').parentElement).toHaveTextContent('—');
  });
});

// ADR-0141 D-24: a linha secundária do preço-alvo do ML sai junto com a coluna do Radar. Se
// engana na coluna, engana no dialog — e engana também quem não assina o módulo.
describe('DialogDetalhe — D-24: o preço-alvo do ML não existe mais', () => {
  // 82,00 >= 70,19 (o menor relevante da fixture) de propósito: é exatamente a condição que o
  // código removido exigia para renderizar. Com um valor abaixo do menor relevante o teste
  // passaria sem provar nada.
  it('não mostra o preço-alvo mesmo com a referência aplicável e acima do menor relevante', () => {
    renderDetalhe({
      ...produtoBase, codigo_pai: 'APTAMIL-1800',
      ptw_aplicavel: true, ptw_preco_sugerido: 82, ptw_status: 'with_benchmark_high',
    });

    expect(screen.queryByText(/Preço-alvo do algoritmo do ML/)).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$\s*82,00/)).not.toBeInTheDocument();
  });
});

// `pulse_ofertas` guarda só o que MUDOU no dia. O gráfico tirava o mínimo dessas linhas, então num
// dia em que só ofertas caras mexeram ele subia. Medido no Aptamil Premium 1 (2026-08-29): mínimo
// real R$ 36,00 desde 20/08 e o gráfico marcando R$ 79,99 — uma alta de 122% que não aconteceu.
describe('DialogDetalhe — o gráfico do menor preço não inventa alta', () => {
  it('mantém a oferta barata vigente nos dias em que só as caras foram regravadas', () => {
    detalhe.ofertas = [
      oferta({ item_id: 'BARATA', preco: 36, dia: '2026-08-20' }),
      oferta({ item_id: 'CARA', seller_id: 2, preco: 90, dia: '2026-08-20' }),
      oferta({ item_id: 'CARA', seller_id: 2, preco: 79.99, dia: '2026-08-28' }),
    ];
    detalhe.ofertasAtuais = [
      oferta({ item_id: 'BARATA', preco: 36, dia: '2026-08-20' }),
      oferta({ item_id: 'CARA', seller_id: 2, preco: 79.99, dia: '2026-08-28' }),
    ];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    // O gráfico declara a faixa no aria-label: piso e teto do período.
    const grafico = screen.getByRole('img', { name: /Menor preço variou/ });
    expect(grafico).toHaveAccessibleName(/de\s*R\$\s*36,00/);
    // A conta antiga produziria R$ 79,99 como topo da série do menor preço.
    expect(grafico).not.toHaveAccessibleName(/a\s*R\$\s*79,99/);
  });
});

// A fixture padrão tem a oferta de R$ 36,00 (vendedor sem histórico) e a de R$ 70,19 (relevante).
describe('DialogDetalhe — aviso das ofertas abaixo da referência', () => {
  it('conta as ofertas abaixo e diz o quanto a mais barata está abaixo', () => {
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    const aviso = screen.getByText(/oferta ativa abaixo da sua referência|ofertas ativas abaixo da sua referência/);
    expect(aviso).toBeInTheDocument();
    expect(aviso.parentElement).toHaveTextContent(/R\$\s*36,00/);
    expect(aviso.parentElement).toHaveTextContent(/49% abaixo/);
  });

  // O ponto todo do aviso: ele NÃO afirma quem leva a venda. O ganhador do buy-box não é obtenível
  // (Spike 049) e o mais barato não é o ganhador (9 de 17 catálogos medidos).
  it('não afirma quem leva a venda nem chama o mais barato de ganhador', () => {
    const { container } = renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });
    expect(container.textContent).not.toMatch(/ganhador|buy.?box|leva a venda|está levando/i);
  });

  it('sem oferta abaixo da referência, não existe aviso', () => {
    detalhe.ofertasAtuais = [oferta({ item_id: 'MLB-OFFER-70', seller_id: 2, preco: 70.19 })];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });
    expect(screen.queryByText(/abaixo da sua referência/)).not.toBeInTheDocument();
  });
});

// O Radar mostrava o DELTA de transactions_total como "≈N no período" — número que o Spike 048
// provou não ser venda, e que o Sonar já tinha corrigido (ADR-0146). As duas telas passam a usar a
// mesma definição: média mensal de 12 meses, com o delta virando tendência.
describe('DialogDetalhe — porte do vendedor em vez de "vendas na conta"', () => {
  it('mostra a média mensal de 12 meses, não o total nem o delta', () => {
    // vendedor 2 da fixture: transactions_total 10 → 10/12 ≈ 1/mês.
    detalhe.vendedores = [
      { ...vendedor(2, 'OUTRO'), transactions_total: 2400, dia: '2026-08-20' },
      { ...vendedor(2, 'OUTRO'), transactions_total: 2412, dia: '2026-08-29' },
    ];
    detalhe.ofertasAtuais = [oferta({ item_id: 'MLB-OFFER-70', seller_id: 2, preco: 70.19, visitas_30d: 735 })];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    expect(screen.getByRole('columnheader', { name: 'Porte do vendedor' })).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();          // 2412 / 12
    expect(screen.getByText(/vende mais que há 1 ano/)).toBeInTheDocument();
    // O rótulo antigo e o total cru saem de cena.
    expect(screen.queryByRole('columnheader', { name: 'Vendas na conta' })).not.toBeInTheDocument();
    expect(screen.queryByText(/no período/)).not.toBeInTheDocument();
    expect(screen.queryByText('2.412')).not.toBeInTheDocument();
  });

  it('uma leitura só dá porte sem afirmar direção', () => {
    detalhe.vendedores = [{ ...vendedor(2, 'OUTRO'), transactions_total: 2412, dia: '2026-08-29' }];
    detalhe.ofertasAtuais = [oferta({ item_id: 'MLB-OFFER-70', seller_id: 2, preco: 70.19 })];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });

    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.queryByText(/há 1 ano/)).not.toBeInTheDocument();
  });

  it('a coluna não promete venda daquele anúncio', () => {
    const { container } = renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });
    expect(container.textContent).not.toMatch(/vendas do anúncio|vendeu neste produto/i);
  });
});

describe('DialogDetalhe — visitas, FULL e composição', () => {
  it('mostra a fatia de visitas entre os relevantes', () => {
    detalhe.ofertasAtuais = [
      oferta({ item_id: 'A', seller_id: 2, preco: 70.19, visitas_30d: 735 }),
      oferta({ item_id: 'B', seller_id: 2, preco: 76, visitas_30d: 245 }),
    ];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });
    expect(screen.getByText(/75% das visitas/)).toBeInTheDocument();
  });

  it('anúncio no FULL se identifica — o dado era coletado e nunca exibido', () => {
    detalhe.ofertasAtuais = [oferta({ item_id: 'A', seller_id: 2, preco: 70.19, full_ml: true })];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });
    expect(screen.getByTitle(/Mercado Envios Full/)).toBeInTheDocument();
  });

  it('a composição dos relevantes aparece acima da tabela', () => {
    detalhe.ofertasAtuais = [
      oferta({ item_id: 'A', seller_id: 2, preco: 70.19, frete_gratis: true, full_ml: true }),
      oferta({ item_id: 'B', seller_id: 2, preco: 99, frete_gratis: false, full_ml: false }),
    ];
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1800' });
    expect(screen.getByText(/1 com frete grátis/)).toBeInTheDocument();
    expect(screen.getByText(/1 no FULL/)).toBeInTheDocument();
    expect(screen.getByText(/disputa de R\$\s*70,19 a R\$\s*99,00/)).toBeInTheDocument();
  });
});

// Filho de grid tem min-width:auto e não encolhe: em 820px o dialog cortava "Sua posição" e o
// botão "Reprecificar" pela direita, sem barra de rolagem.
describe('DialogDetalhe — o conteúdo pode encolher dentro do grid do dialog', () => {
  it('o corpo do dialog carrega min-w-0', () => {
    renderDetalhe();
    const corpo = document.querySelector('[data-slot="dialog-content"] > .flex.flex-col.gap-5');
    expect(corpo).not.toBeNull();
    expect(corpo).toHaveClass('min-w-0');
  });
});

// ADR-0150 D-1: `%` sozinho não diz o denominador, e markup e margem s/ venda convivem no Pulse.
describe('DialogDetalhe — o percentual da sobra diz o denominador', () => {
  it('mostra "s/ venda" junto do percentual', () => {
    renderDetalheComMargem();
    expect(screen.getByText(/43\.0%\s*s\/\s*venda/)).toBeInTheDocument();
  });
});

describe('DialogDetalhe — a tabela de concorrentes cabe na tela', () => {
  it('são 7 colunas, e Reputação/MercadoLíder não existem mais como colunas próprias', () => {
    renderDetalheComOfertas();
    const cabecalhos = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(cabecalhos).toEqual([
      'Preço', 'Vendedor', 'Estado', 'Porte do vendedor', 'Visitas 30d', 'Anúncio', 'Oferta',
    ]);
  });

  it('a reputação e o selo de MercadoLíder continuam visíveis, dentro de "Vendedor"', () => {
    renderDetalheComOfertas();
    const celula = screen.getByText('LOJA UM').closest('td')!;
    expect(within(celula).getByText(/Reputação verde/)).toBeInTheDocument();
    expect(within(celula).getByText(/MercadoLíder Platinum/)).toBeInTheDocument();
    expect(within(celula).getByText('Relevante')).toBeInTheDocument();
  });
});

// A decomposição vivia só no `title`: tooltip não funciona em touch e some em demo projetada. Foi
// uma comissão errada e silenciosa que superestimou a sobra deste produto em R$ 0,97 (Errata 6).
describe('DialogDetalhe — a conta da margem fica à vista', () => {
  it('os quatro descontos aparecem como números na tela, não só no title', () => {
    renderDetalheComMargem(); // custo 30, alíquota 8%, comissão 14%, frete 5, preço 100
    expect(screen.getByText('Comissão do ML')).toBeInTheDocument();
    expect(screen.getByText('Frete')).toBeInTheDocument();
    expect(screen.getByText('Imposto (8%)')).toBeInTheDocument();
    expect(screen.getByText('Custo do produto')).toBeInTheDocument();
    expect(screen.getByText('−R$ 14,00')).toBeInTheDocument();
    expect(screen.getByText('−R$ 5,00')).toBeInTheDocument();
    expect(screen.getByText('−R$ 8,00')).toBeInTheDocument();
    expect(screen.getByText('−R$ 30,00')).toBeInTheDocument();
  });

  it('sem insumo, não há decomposição — só o motivo', () => {
    // `codigo_pai` é obrigatório: sem ele o bloco de decisão inteiro não renderiza
    // (dialog-detalhe.tsx:427). contexto mock (beforeEach/afterEach) já é custo/alíquota null.
    renderDetalhe({ ...produtoBase, codigo_pai: 'APTAMIL-1' });
    expect(screen.getByText(/Margem indisponível: falta custo do produto/)).toBeInTheDocument();
    expect(screen.queryByText('Comissão do ML')).not.toBeInTheDocument();
    // Regra LOUD: insumo ausente nunca vira zero.
    expect(screen.queryByText('−R$ 0,00')).not.toBeInTheDocument();
  });
});
