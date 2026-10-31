import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReguaMargem } from '@/components/ads/campanhas/regua-margem';
import { LinhaMlb } from '@/components/ads/campanhas/linha-mlb';
import { BlocoCampanha } from '@/components/ads/campanhas/bloco-campanha';
import { AbaCampanhas, type DadosCampanhas } from '@/components/ads/campanhas/aba-campanhas';
import type { AnuncioPatrocinado, CampanhaVista, FamiliaCampanha } from '@/lib/ads-campanhas';
import { useAdsMetricas } from '@/hooks/useAdsMetricas';

vi.mock('@/hooks/useAdsMetricas', () => ({ useAdsMetricas: vi.fn() }));

const anuncio = (over: Partial<AnuncioPatrocinado> = {}): AnuncioPatrocinado => ({
  mlb: 'MLB1', campanhaId: 1, grupoId: null, statusAds: 'active', catalogo: false, titulo: 'Camiseta Azul',
  thumbnail: 'https://img/1.jpg', permalink: 'https://produto.mercadolivre.com.br/MLB1',
  item: { status: 'active', subStatus: [], estoque: 7, preco: 59.9 }, equilibrio: { acosPct: 32, motivo: null }, ...over,
});
const familia = (over: Partial<FamiliaCampanha> = {}): FamiliaCampanha => ({
  codigoPai: 'P1', nome: 'Camiseta', anuncios: [anuncio()], equilibrioPct: 32, motivoEquilibrio: null,
  patrocinados: 2, publicados: 3, alertas: [], ...over,
});
const campanha = (over: Partial<CampanhaVista> = {}): CampanhaVista => ({
  id: 1, nome: 'Campanha Verão', status: 'active', estrategia: 'PROFITABILITY', roasObjetivo: 5, acosObjetivo: 20,
  orcamentoDiario: 10, familias: [familia()], foraDoPubliai: [], totalAlertas: 0, ...over,
});
const pagina = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ReguaMargem', () => {
  it('normal: texto com equilíbrio e alvo, barra verde com marcador', () => {
    render(<ReguaMargem equilibrioPct={32} motivo={null} acosAlvo={20} acima={false} />);
    expect(screen.getByRole('img', { name: 'Margem para Ads: Aguenta até 32% · alvo 20%' })).toBeInTheDocument();
    expect(screen.getByText('Aguenta até 32% · alvo 20%')).toBeVisible();
    expect(screen.getByTestId('regua-preenchimento')).toHaveClass('bg-success');
    expect(screen.getByTestId('regua-alvo')).toBeInTheDocument();
  });
  it('alvo acima do equilíbrio: barra e texto em perigo, escala cobre o alvo', () => {
    render(<ReguaMargem equilibrioPct={15.25} motivo={null} acosAlvo={25} acima />);
    expect(screen.getByTestId('regua-preenchimento')).toHaveClass('bg-danger');
    expect(screen.getByText('Aguenta até 15,2% · alvo 25%')).toHaveClass('text-danger');
    const alvo = parseFloat(screen.getByTestId('regua-alvo').style.left);
    expect(alvo).toBeLessThanOrEqual(100);
    expect(alvo).toBeGreaterThan(parseFloat(screen.getByTestId('regua-preenchimento').style.width));
  });
  it('equilíbrio <= 0: sem espaço, sem barra', () => {
    render(<ReguaMargem equilibrioPct={0} motivo={null} acosAlvo={20} acima={false} />);
    expect(screen.getByText('Sem espaço para Ads · alvo 20%')).not.toHaveClass('text-danger');
    expect(screen.queryByTestId('regua-preenchimento')).not.toBeInTheDocument();
  });
  it('sem referência: motivo legível, sem barra', () => {
    render(<ReguaMargem equilibrioPct={null} motivo="sem_custo" acosAlvo={20} acima={false} />);
    expect(screen.getByText('Sem custo cadastrado')).toHaveClass('text-muted-foreground');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('sem alvo: barra sem marcador e texto sem alvo', () => {
    render(<ReguaMargem equilibrioPct={32} motivo={null} acosAlvo={null} acima={false} />);
    expect(screen.getByText('Aguenta até 32%')).toBeVisible();
    expect(screen.queryByTestId('regua-alvo')).not.toBeInTheDocument();
  });
});

describe('LinhaMlb', () => {
  const linha = (a: AnuncioPatrocinado, equilibrio = true) => render(<ul><LinhaMlb a={a} equilibrio={equilibrio} /></ul>);
  it('ativo: miniatura, link externo, estoque, preço e equilíbrio do MLB', () => {
    linha(anuncio());
    expect(screen.getByRole('img', { name: 'Camiseta Azul' })).toHaveAttribute('loading', 'lazy');
    const link = screen.getByRole('link', { name: /Camiseta Azul/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(within(link).getByText('abre no Mercado Livre')).toHaveClass('sr-only');
    expect(screen.getByText('MLB1')).toBeInTheDocument();
    expect(screen.getByText(/Estoque 7/)).toBeInTheDocument();
    expect(screen.getByText(/59,90/)).toBeInTheDocument();
    expect(screen.getByText('até 32%')).toBeInTheDocument();
  });
  it('hold no Ads aparece como Em espera, neutro', () => {
    linha(anuncio({ statusAds: 'hold' }));
    expect(screen.getByText('Em espera')).toHaveAttribute('data-tone', 'neutral');
  });
  it('item pausado sem estoque: Pausado · sem estoque, em aviso', () => {
    linha(anuncio({ item: { status: 'paused', subStatus: ['out_of_stock'], estoque: 0, preco: 10 } }));
    expect(screen.getByText('Pausado · sem estoque')).toHaveAttribute('data-tone', 'warning');
  });
  it('item null: Status indisponível, sem estoque nem preço', () => {
    linha(anuncio({ item: null }));
    expect(screen.getByText('Status indisponível')).toBeInTheDocument();
    expect(screen.queryByText(/Estoque/)).not.toBeInTheDocument();
  });
  it('sem miniatura usa a caixa de reserva; sem equilíbrio no grupo fora do PubliAI', () => {
    linha(anuncio({ thumbnail: null }), false);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/até 32%/)).not.toBeInTheDocument();
  });
  it('MLB sem referência mostra o motivo', () => {
    linha(anuncio({ equilibrio: { acosPct: null, motivo: 'sem_custo' } }));
    expect(screen.getByText('Sem custo cadastrado')).toBeInTheDocument();
  });
});

describe('BlocoCampanha', () => {
  it('cabeçalho: nome, estado, estratégia e meta', () => {
    pagina(<BlocoCampanha c={campanha()} filtrando={false} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Campanha Verão' })).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('Rentabilidade')).toBeInTheDocument();
    expect(screen.getByText(/Orçamento diário/)).toHaveTextContent(/10,00/);
    expect(screen.getByText(/ROAS objetivo 5x/)).toHaveTextContent('ACOS-alvo 20%');
    expect(screen.getByText('1 anúncio patrocinado')).toBeInTheDocument();
  });
  it('grupos distintos ficam separados da quantidade de MLBs, sem dupla contagem', () => {
    const as = [anuncio({ mlb: 'MLB1', grupoId: 10 }), anuncio({ mlb: 'MLB2', grupoId: 10 }), anuncio({ mlb: 'MLB3', grupoId: 11 })];
    const fora = anuncio({ mlb: 'MLB3', grupoId: 11 });
    pagina(<BlocoCampanha c={campanha({ familias: [familia({ anuncios: as })], foraDoPubliai: [fora] })} filtrando={false} />);
    expect(screen.getByText('2 grupos · 3 anúncios patrocinados')).toBeInTheDocument();
  });
  it('estratégia desconhecida aparece crua e null some', () => {
    const { unmount } = pagina(<BlocoCampanha c={campanha({ estrategia: 'GROWTH' })} filtrando={false} />);
    expect(screen.getByText('GROWTH')).toBeInTheDocument();
    unmount();
    pagina(<BlocoCampanha c={campanha({ estrategia: null })} filtrando={false} />);
    expect(screen.queryByText('Rentabilidade')).not.toBeInTheDocument();
  });
  it('família: patrocínio, alertas com tom e link para a família', () => {
    const f = familia({ alertas: ['roas_acima_margem', 'patrocinado_parado', 'parcialmente_patrocinada'] });
    pagina(<BlocoCampanha c={campanha({ familias: [f] })} filtrando={false} />);
    const linha = within(screen.getByRole('row', { name: /Camiseta/ }));
    expect(linha.getByText('2 de 3 anúncios')).toBeInTheDocument();
    expect(linha.getByText('ACOS-alvo acima do equilíbrio')).toHaveAttribute('data-tone', 'danger');
    expect(linha.getByText('Patrocinado parado')).toHaveAttribute('data-tone', 'warning');
    expect(linha.getByText('Parcialmente patrocinada')).toHaveAttribute('data-tone', 'neutral');
    expect(linha.getByRole('link', { name: 'Camiseta' })).toHaveAttribute('href', '/faturamento/sku/familia/P1');
  });
  it('sem anúncios publicados diz que não foi publicado pelo PubliAI', () => {
    pagina(<BlocoCampanha c={campanha({ familias: [familia({ publicados: 0, patrocinados: 0 })] })} filtrando={false} />);
    expect(within(screen.getByRole('row', { name: /Camiseta/ })).getByText('Não publicado pelo PubliAI')).toBeInTheDocument();
  });
  it('detalhe lista os MLBs e oferece Ver desempenho só quando permitido', () => {
    const ver = vi.fn();
    pagina(<BlocoCampanha c={campanha()} filtrando={false} verDesempenho={ver} temDesempenho={() => true} />);
    fireEvent.click(within(screen.getByRole('row', { name: /Camiseta/ })).getByRole('button', { name: 'Ver anúncios de Camiseta' }));
    expect(screen.getAllByText('Camiseta Azul').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ver desempenho' }));
    expect(ver).toHaveBeenCalledWith('P1');
  });
  it('sem permissão de desempenho o link não aparece', () => {
    pagina(<BlocoCampanha c={campanha()} filtrando={false} verDesempenho={vi.fn()} temDesempenho={() => false} />);
    fireEvent.click(within(screen.getByRole('row', { name: /Camiseta/ })).getByRole('button', { name: 'Ver anúncios de Camiseta' }));
    expect(screen.queryByRole('button', { name: 'Ver desempenho' })).not.toBeInTheDocument();
  });
  it('campanha pausada nasce recolhida, sem alertas, e expande sob demanda', () => {
    pagina(<BlocoCampanha c={campanha({ status: 'paused', familias: [familia()] })} filtrando={false} />);
    expect(screen.getByText('Pausada')).toHaveAttribute('data-tone', 'neutral');
    expect(screen.queryByRole('row', { name: /Camiseta/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Alertas')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir Campanha Verão' }));
    expect(screen.getByRole('row', { name: /Camiseta/ })).toBeInTheDocument();
    // Pausada: sem "0 de N" nem "Fora da projeção" (a margem não é calculada por definição).
    expect(screen.getAllByText('Campanha pausada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Não calculada: campanha pausada').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Fora da projeção/)).not.toBeInTheDocument();
  });
  it('campanha reativada (pausada → ativa) mostra o conteúdo sem precisar remontar', () => {
    const { rerender } = pagina(<BlocoCampanha c={campanha({ status: 'paused', familias: [familia()] })} filtrando={false} />);
    expect(screen.queryByRole('row', { name: /Camiseta/ })).not.toBeInTheDocument();
    rerender(<MemoryRouter><BlocoCampanha c={campanha({ status: 'active', familias: [familia()] })} filtrando={false} /></MemoryRouter>);
    expect(screen.getByRole('row', { name: /Camiseta/ })).toBeInTheDocument();
  });
  it('grupo Fora do PubliAI só aparece quando há anúncios, sem equilíbrio', () => {
    const { unmount } = pagina(<BlocoCampanha c={campanha()} filtrando={false} />);
    expect(screen.queryByText('Fora do PubliAI')).not.toBeInTheDocument();
    unmount();
    pagina(<BlocoCampanha c={campanha({ foraDoPubliai: [anuncio({ mlb: 'MLB9', titulo: 'Solto' })] })} filtrando={false} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Fora do PubliAI' })).toBeInTheDocument();
    expect(screen.getByText('Anúncios sem família no PubliAI: sem margem calculada.')).toBeInTheDocument();
    const grupo = within(screen.getByRole('list', { name: 'Anúncios fora do PubliAI' }));
    expect(grupo.getByText('MLB9')).toBeInTheDocument();
    expect(grupo.queryByText(/até 32%/)).not.toBeInTheDocument();
  });
});

describe('AbaCampanhas', () => {
  const PEDIDO = { desde: '2026-09-04', ate: '2026-10-03', comparar: 'anterior' as const };
  const blocoMetricas = (cost: number) => ({
    janela: { desde: PEDIDO.desde, ate: PEDIDO.ate }, resumo: { cost: { valor: cost, motivo: null } }, serie: [], completo: true,
    lidoEm: '2026-10-04T12:00:00Z',
  });
  const metricas = (over: Record<string, unknown> = {}) => ({
    data: { ok: true, estado: 'ok', escopo: 'campanhas', atual: null, anterior: null,
      campanhas: [{ id: 1, nome: 'Campanha Verão', statusAtual: 'active', atual: blocoMetricas(42), anterior: null }],
      comparacao: { estado: 'desligada', motivo: null }, disponibilidade: { desde: '2026-04-01', ate: '2026-10-03', fuso: 'America/Sao_Paulo' }, avisos: [] },
    isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(), ...over,
  });
  const dados = (over: Partial<DadosCampanhas> = {}, campanhas: CampanhaVista[] | null = [campanha()]): DadosCampanhas => ({
    resposta: { ok: true, estado: 'ok', lidoEm: '2026-10-20T15:05:00Z', aliquotasConfirmadas: true, projecaoLimitada: false,
      publicadosPorFamilia: {}, campanhas: [], anuncios: [] },
    campanhas, isLoading: false, isError: false, erro: null, atualizando: false, atualizar: vi.fn(), erroAtualizar: null, tentarDeNovo: vi.fn(), ...over,
  });
  const aba = (d: DadosCampanhas, m = metricas()) => {
    // O detalhe lê as próprias métricas: segue carregando nestes testes.
    vi.mocked(useAdsMetricas).mockReturnValue({ ...metricas(), data: undefined, isLoading: true } as never);
    return pagina(<AbaCampanhas dados={d} metricas={m as never} pedido={PEDIDO} conta={<p>Bloco da conta</p>}
      integridade={<p>Integridade da conta</p>} />);
  };

  it('tabela do período depois do bloco da conta; integridade no fim', () => {
    aba(dados());
    expect(screen.getByText('Bloco da conta')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Campanha Verão/ })).toHaveTextContent(/R\$\s*42,00/);
    expect(screen.getByText('Integridade da conta')).toBeInTheDocument();
  });
  it.each([
    ['carregando', { isLoading: true, resposta: null, campanhas: null }, 'Lendo a configuração atual…'],
    ['com erro', { isError: true, erro: new Error('x'), resposta: null, campanhas: null }, 'Configuração atual indisponível agora; as métricas do período continuam valendo.'],
  ] as const)('detalhe com a configuração %s não diz que a campanha saiu', (_n, over, texto) => {
    aba(dados(over as Partial<DadosCampanhas>));
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver campanha Campanha Verão' })[0]);
    const detalhe = within(screen.getByRole('dialog'));
    expect(detalhe.getByText(texto)).toBeInTheDocument();
    expect(detalhe.queryByText(/não está mais entre as campanhas/)).not.toBeInTheDocument();
  });
  it('carregando as métricas: esqueleto', () => {
    aba(dados(), metricas({ data: undefined, isLoading: true }));
    expect(screen.getByRole('status', { name: 'Carregando campanhas' })).toBeInTheDocument();
  });
  it('erro das métricas: alerta e Tentar novamente', () => {
    const m = metricas({ data: undefined, isError: true });
    aba(dados(), m);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível ler as campanhas do período no Mercado Livre.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(m.refetch).toHaveBeenCalled();
  });
  it('sem_conexao nas métricas: pede para conectar em Canais', () => {
    const m = metricas();
    aba(dados(), { ...m, data: { ...m.data, estado: 'sem_conexao', campanhas: [] } });
    expect(screen.getByText('Conecte sua conta do Mercado Livre em Canais para ver as campanhas.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir Canais' })).toHaveAttribute('href', '/configuracoes/canais');
  });
  it('configuração carregando ou com erro não esconde a tabela do período', () => {
    const tentarDeNovo = vi.fn();
    const { unmount } = aba(dados({ isLoading: true, resposta: null, campanhas: null }));
    expect(screen.getByRole('row', { name: /Campanha Verão/ })).toBeInTheDocument();
    unmount();
    aba(dados({ isError: true, erro: new Error('Falhou no ML'), tentarDeNovo }));
    expect(screen.getByRole('row', { name: /Campanha Verão/ })).toBeInTheDocument();
    expect(screen.getByText(/Configuração atual indisponível/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(tentarDeNovo).toHaveBeenCalled();
  });
  it('avisos de alíquota e de projeção limitada', () => {
    const base = dados();
    aba({ ...base, resposta: { ...(base.resposta as object), aliquotasConfirmadas: false, projecaoLimitada: true } as never });
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('href', '/configuracoes');
    expect(screen.getByText('Alguns anúncios ficaram fora da projeção de margem nesta leitura.')).toBeInTheDocument();
  });
  it('rodapé: configuração lida às (BRT), Atualizar configuração e notas', () => {
    const atualizar = vi.fn();
    aba(dados({ atualizar }));
    expect(screen.getByText('Configuração lida às 12:05')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar configuração' }));
    expect(atualizar).toHaveBeenCalled();
    expect(screen.getByText(/Margem para Ads = ACOS máximo/)).toBeInTheDocument();
    expect(screen.queryByText(/ficam em Desempenho/)).not.toBeInTheDocument();
  });
  it('Atualizar desabilitado enquanto atualiza; falha mantém a última leitura', () => {
    aba(dados({ atualizando: true, erroAtualizar: new Error('rede') }));
    expect(screen.getByRole('button', { name: 'Atualizando…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível atualizar agora; a configuração exibida é da última leitura.');
  });
  it('famílias em alerta levam ao detalhe da campanha com os produtos atuais', () => {
    aba(dados({}, [campanha({ familias: [familia({ alertas: ['patrocinado_parado'] })] })]));
    fireEvent.click(screen.getByRole('button', { name: 'Campanha Verão · 1 família' }));
    const detalhe = within(screen.getByRole('dialog'));
    expect(detalhe.getAllByRole('heading', { name: 'Campanha Verão' })[0]).toBeInTheDocument();
    expect(detalhe.getByText('Produtos patrocinados atualmente')).toBeInTheDocument();
  });
  it('abrir pela tabela usa o nome do período e a configuração atual da mesma campanha', () => {
    aba(dados());
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver campanha Campanha Verão' })[0]);
    expect(within(screen.getByRole('dialog')).getByText('Configuração atual')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).queryByText(/não está mais entre as campanhas/)).not.toBeInTheDocument();
  });
  it('Esc no detalhe devolve o foco ao botão que o abriu', async () => {
    aba(dados());
    const botao = screen.getAllByRole('button', { name: 'Ver campanha Campanha Verão' })[0];
    botao.focus();
    fireEvent.click(botao);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(botao).toHaveFocus());
  });
});
