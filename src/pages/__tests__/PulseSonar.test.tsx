import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PulseSonar, { SonarVendas, SonarEanCruzamento } from '../PulseSonar';
import { fetchVendasSonar } from '@/lib/sonar';
import type { CruzamentoEan, ItemVendasSonar, PainelVendasSonar } from '@/lib/sonar';

// Card "Produto destaque" (SonarVendas): mesma regra de href do item_id da coluna de ações
// (D15/ADR-0127), aplicada ao `produto_destaque` do payload — ver task 15/16 (coordenador pediu
// paridade depois de o achado ficar restrito à coluna de ações).
function itemBase(overrides: Partial<ItemVendasSonar>): ItemVendasSonar {
  return {
    titulo: 'Produto destaque', preco: 100, vendidos: 10, link: null, imagem: null, vendedor: null,
    frete_gratis: null, loja_oficial: null, internacional: null, full: null, item_id: null,
    catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null, posicao: null,
    patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null, flex: null,
    ...overrides,
  };
}

function respBase(destaque: ItemVendasSonar | null): PainelVendasSonar {
  return {
    configurado: true, termo: 'tecido oxford', gerado_em: '2026-08-19T00:00:00Z',
    itens_analisados: 1, itens_com_vendas: 1, vendas_totais: 10, valor_mercado: 1000,
    produto_destaque: destaque, palavras_chave_titulos: [],
    raio_x: { total_anuncios: null, ticket_medio: null, lojas_oficiais: 0, full: 0, frete_gratis: 0, internacionais: 0 },
  };
}

describe('SonarVendas — card "Produto destaque" usa a mesma regra de link da coluna de ações', () => {
  it('link com domínio duplicado (caso real) cai para a URL canônica via item_id', () => {
    const destaque = itemBase({
      titulo: 'Tecido Oxford',
      link: 'https://www.mercadolivre.com.br/produto.mercadolivre.com.br/MLB-4278232959-tecido',
      item_id: 'MLB4278232959',
    });
    render(<SonarVendas resp={respBase(destaque)} />);
    expect(screen.getByRole('link', { name: 'Tecido Oxford' }))
      .toHaveAttribute('href', 'https://produto.mercadolivre.com.br/MLB-4278232959');
  });

  it('sem item_id disponível e sem link utilizável: sem link, mas o título continua visível', () => {
    const destaque = itemBase({ titulo: 'Sem item_id', link: null, item_id: null });
    render(<SonarVendas resp={respBase(destaque)} />);
    expect(screen.queryByRole('link', { name: 'Sem item_id' })).not.toBeInTheDocument();
    expect(screen.getByText('Sem item_id')).toBeInTheDocument();
  });
});

// ADR-0140 D-3: a consulta por EAN deixou de ter view própria — percorre o mesmo pipeline da busca
// por termo. O cruzamento com o catálogo da org é a única peça que sobrou dela, e as suas duas
// metades passaram a ter confiabilidade diferente: `minhas` vem de `variacoes.gtin` (exato, local),
// `no_radar` vem de `catalog_product_id` colhido da amostra da busca — que na medição de 28/08
// trouxe o id em 7 dos 20 anúncios. Por isso o Radar só pode ser afirmado no positivo.
describe('SonarEanCruzamento — afirma o que mediu, cala sobre o que não mediu', () => {
  const vazio: CruzamentoEan = { minhas: [], no_radar: null };

  it('já vendo o produto: mostra código e preço da variação', () => {
    const cruzamento: CruzamentoEan = {
      minhas: [{ codigo: '00123', nome: 'Linha Encanto Slim', preco: 39.9 }],
      no_radar: null,
    };
    render(<SonarEanCruzamento cruzamento={cruzamento} />);
    expect(screen.getByText(/Você já vende: 00123 \(R\$ 39,90\)/)).toBeInTheDocument();
  });

  it('produto já monitorado: informa o Radar, com o status quando não está ativo', () => {
    const cruzamento: CruzamentoEan = {
      minhas: [],
      no_radar: { id: 'p1', titulo: 'Linha Encanto Slim', status: 'pausado' },
    };
    render(<SonarEanCruzamento cruzamento={cruzamento} />);
    expect(screen.getByText(/Já está no seu Radar \(pausado\)/)).toBeInTheDocument();
  });

  it('nada encontrado: afirma só o catálogo (GTIN exato) e NÃO nega o Radar', () => {
    render(<SonarEanCruzamento cruzamento={vazio} />);
    // A ausência em `variacoes.gtin` é medição exata — pode virar frase.
    expect(screen.getByText(/Produto novo para o seu catálogo/)).toBeInTheDocument();
    // A ausência no Radar NÃO é: os ids de catálogo vêm parciais da amostra. Dizer "não está no
    // Radar" a partir disso é a mentira que a regra LOUD proíbe.
    expect(screen.queryByText(/Radar/)).not.toBeInTheDocument();
  });
});

// ADR-0140 D-1/D-2: o EAN percorre o MESMO pipeline da busca por termo. Estes testes montam a
// página inteira porque o que se quer travar é o roteamento e o ciclo do leitor de código de
// barras — nada disso aparece num teste de componente isolado, e a limpeza do campo já se perdeu
// uma vez (ao remover os handlers da view antiga) sem quebrar tsc, lint nem a suíte.
vi.mock('@/lib/sonar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sonar')>()),
  // Resolve em `configurado: false` (estado terminal legítimo, ADR-0122 §5): o que estes testes
  // olham é o roteamento e o campo, não o painel. Promessa pendente não serve — enquanto a busca
  // corre o botão de submit fica desabilitado, e sem submit habilitado o Enter do input não
  // submete o form (submissão implícita do HTML), o que travaria o 2º scan.
  fetchVendasSonar: vi.fn(async () => ({ configurado: false as const })),
  fetchVisitasSonar: vi.fn(async () => ({ conectado: false as const })),
  fetchCruzamentoEan: vi.fn(async () => ({ minhas: [], no_radar: null })),
  // Pendente para sempre: mantém a Análise PubliAI em "carregando" e evita um `fetch` real.
  fetchSecoes237Sonar: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock('@/lib/sonar-buscas-recentes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sonar-buscas-recentes')>()),
  lerBuscasRecentes: () => [],
  registrarBusca: () => [],
}));

function renderSonar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PulseSonar />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return screen.getByLabelText(/Termo de busca ou EAN/i);
}

/** Página com uma amostra: o mock de `fetchVendasSonar` devolve `itens`, e o termo é digitado como o
 *  operador faria. Resolve quando a tabela aparece (o stepper segura o resultado por 400 ms). */
async function renderSonarComAmostra(itens: ItemVendasSonar[], termo = 'tecido oxford') {
  vi.mocked(fetchVendasSonar).mockResolvedValue({
    ...respBase(null), termo, itens, itens_analisados: itens.length, itens_com_vendas: itens.length,
  });
  const campo = renderSonar();
  await userEvent.type(campo, `${termo}{Enter}`);
  await screen.findByRole('table', {}, { timeout: 3000 });
  return campo;
}

/** Título na TABELA — o mesmo texto aparece no pódio do veredito e no `dre-ancora`. */
const linhaDaTabela = (titulo: string) =>
  screen.getAllByText(titulo).map((el) => el.closest('tr')).find((tr): tr is HTMLTableRowElement => tr != null)!;

describe('PulseSonar — EAN vai para a análise completa, como a busca por descrição', () => {
  beforeEach(() => { vi.mocked(fetchVendasSonar).mockClear(); });

  it('EAN não pergunta mais "grátis ou paga": dispara a mesma busca do termo', async () => {
    const campo = renderSonar();
    await userEvent.type(campo, '7891113175371{Enter}');
    // O pipeline pago da busca por termo, com o EAN como termo — não a edge de catálogo.
    expect(fetchVendasSonar).toHaveBeenCalledWith('7891113175371');
    expect(screen.queryByText(/Consultar grátis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Como consultar o EAN/i)).not.toBeInTheDocument();
  });

  it('após o scan o campo fica vazio e focado — senão o 2º código gruda no 1º', async () => {
    const campo = renderSonar();
    await userEvent.type(campo, '7891113175371{Enter}');
    expect(campo).toHaveValue('');
    expect(campo).toHaveFocus();
    await screen.findByText(/Fonte de dados do Sonar não configurada/i);

    // O leitor emula teclado: digita e manda Enter, sem limpar nem desfocar. Com o campo sujo, o
    // 2º scan viraria "78911131753717891000444764" — 26 dígitos, não casa com EAN_RE, passa pelo
    // piso de 3 caracteres e queima um run pago em lixo.
    await userEvent.type(campo, '7891000444764{Enter}');
    expect(fetchVendasSonar).toHaveBeenLastCalledWith('7891000444764');
  });

  it('termo digitado continua no campo: quem digita quer ver e editar o que buscou', async () => {
    const campo = renderSonar();
    await userEvent.type(campo, 'tecido oxford 10 metros{Enter}');
    expect(campo).toHaveValue('tecido oxford 10 metros');
    expect(fetchVendasSonar).toHaveBeenCalledWith('tecido oxford 10 metros');
  });
});

// ADR-0150 D-2: o Sonar tinha dois simuladores com bases diferentes respondendo à mesma pergunta.
describe('PulseSonar — um simulador só', () => {
  const amostra = () => [
    itemBase({ titulo: 'Oxford Marrom', item_id: 'MLB1', preco: 100, category_id: 'MLB1234', vendidos: 50 }),
    itemBase({ titulo: 'Oxford Azul', item_id: 'MLB2', preco: 80, category_id: 'MLB1234', vendidos: 10 }),
  ];

  it('"Simular" troca a âncora da DRE em vez de abrir um segundo simulador', async () => {
    await renderSonarComAmostra(amostra());

    // Âncora padrão continua sendo o primeiro da amostra (ADR-0148 D-8).
    expect(screen.getByTestId('dre-ancora')).toHaveTextContent('Oxford Marrom');

    await userEvent.click(within(linhaDaTabela('Oxford Azul')).getByRole('button', { name: /Simular/ }));

    expect(screen.getByTestId('dre-ancora')).toHaveTextContent('Oxford Azul');
    // Nada de dialog: o segundo simulador não existe mais.
    expect(screen.queryByRole('dialog', { name: 'Simular margem' })).not.toBeInTheDocument();
  });

  it('buscar outro nicho devolve a âncora ao primeiro anúncio da amostra nova', async () => {
    const campo = await renderSonarComAmostra(amostra());
    await userEvent.click(within(linhaDaTabela('Oxford Azul')).getByRole('button', { name: /Simular/ }));
    expect(screen.getByTestId('dre-ancora')).toHaveTextContent('Oxford Azul');

    // Termo novo → `termoBuscado` muda → a escolha anterior apontaria para um anúncio que não está
    // mais na tela. O mock devolve a mesma amostra para qualquer termo.
    await userEvent.clear(campo);
    await userEvent.type(campo, 'outro nicho{Enter}');
    expect(await screen.findByTestId('dre-ancora', {}, { timeout: 3000 })).toHaveTextContent('Oxford Marrom');
  });
});
