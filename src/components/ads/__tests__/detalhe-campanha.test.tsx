import { cloneElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  AnuncioPeriodoAds, BlocoAdsMetricas, MetricaBrutaAds, RespostaAdsMetricas, ValorAds,
} from '../../../../supabase/functions/_shared/ads/metricas';
import type { CampanhaVista } from '@/lib/ads-campanhas';

vi.mock('@/hooks/useAdsMetricas', () => ({ useAdsMetricas: vi.fn() }));
// Em jsdom o ResponsiveContainer fica 0x0: tamanho fixo para o gráfico existir.
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 280 } as never),
}));

import { useAdsMetricas } from '@/hooks/useAdsMetricas';
import { DetalheCampanha } from '../campanhas/detalhe-campanha';

const ok = (valor: number): ValorAds => ({ valor, motivo: null });
type Res = Partial<Record<MetricaBrutaAds, ValorAds>>;
const m = (cost: number, receita: number, vendas: number, prints: number, clicks: number): Res => ({
  cost: ok(cost), total_amount: ok(receita), advertising_items_quantity: ok(vendas), prints: ok(prints), clicks: ok(clicks), cvr: ok(5),
});
const bloco = (resumo: Res, serie: BlocoAdsMetricas['serie'] = []): BlocoAdsMetricas => ({
  janela: { desde: '2026-10-01', ate: '2026-10-07' }, resumo, serie, completo: true, lidoEm: '2026-10-08T10:00:00Z',
});
const anuncio = (itemId: string, titulo: string | null, atual: Res, anterior: Res | null): AnuncioPeriodoAds => ({
  itemId, titulo, statusAds: 'active', atual: bloco(atual), anterior: anterior && bloco(anterior),
});

const SERIE = [{ dia: '2026-10-01', metricas: { cost: ok(10), total_amount: ok(50), advertising_items_quantity: ok(2), organic_items_quantity: ok(3) } }];
const resposta = (over: Partial<RespostaAdsMetricas> = {}): RespostaAdsMetricas => ({
  ok: true, estado: 'ok', escopo: 'campanha',
  atual: bloco(m(400, 700, 7, 3000, 150), SERIE), anterior: bloco(m(300, 450, 5, 2500, 120)),
  campanhas: [],
  anuncios: [
    anuncio('MLB1', 'Camiseta Azul', m(100, 400, 5, 2000, 100), m(80, 200, 3, 1500, 80)),
    anuncio('MLB2', null, m(300, 300, 2, 1000, 50), m(220, 250, 2, 1000, 40)),
  ],
  anunciosMotivo: null,
  comparacao: { estado: 'disponivel', motivo: null },
  disponibilidade: { desde: '2026-01-01', ate: '2026-10-07', fuso: 'America/Sao_Paulo' },
  avisos: [],
  ...over,
});

const campanha: CampanhaVista = {
  id: 7, nome: 'Campanha Verão', status: 'active', estrategia: 'PROFITABILITY', roasObjetivo: 5, acosObjetivo: 20,
  orcamentoDiario: 10, totalAlertas: 0, foraDoPubliai: [],
  familias: [{
    codigoPai: 'P1', nome: 'Camiseta', anuncios: [], equilibrioPct: 32, motivoEquilibrio: null,
    patrocinados: 1, publicados: 1, alertas: [],
  }],
};

const hook = (data: RespostaAdsMetricas | undefined, extra: Record<string, unknown> = {}) =>
  vi.mocked(useAdsMetricas).mockReturnValue({
    data, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(), ...extra,
  } as never);

const BASE = { desde: '2026-10-01', ate: '2026-10-07', comparar: 'anterior' as const };
const abrir = (over: Partial<React.ComponentProps<typeof DetalheCampanha>> = {}) => render(
  <MemoryRouter>
    <DetalheCampanha campanhaId={7} nome="Campanha Verão" pedido={BASE} campanha={campanha} aberto onFechar={vi.fn()} {...over} />
  </MemoryRouter>,
);
const tabela = () => screen.getByRole('table', { name: 'Anúncios patrocinados no período' });
const ordemIds = () => within(tabela()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');

beforeEach(() => { vi.mocked(useAdsMetricas).mockReset(); hook(resposta()); });

describe('DetalheCampanha', () => {
  it('a consulta só dispara com o detalhe aberto e leva o escopo da campanha', () => {
    abrir({ aberto: false });
    expect(vi.mocked(useAdsMetricas).mock.calls.at(-1)).toEqual([{ ...BASE, escopo: 'campanha', campanhaId: 7 }, false]);
    expect(screen.queryByText('Métricas do período')).toBeNull();
    expect(screen.queryByText('Evolução diária')).toBeNull();
  });

  it('aberto: separa Métricas do período e Configuração atual, com gráfico diário', () => {
    abrir();
    expect(vi.mocked(useAdsMetricas).mock.calls.at(-1)?.[1]).toBe(true);
    const metricas = screen.getByRole('region', { name: 'Métricas do período' });
    expect(within(metricas).getByText('Evolução diária')).toBeInTheDocument();
    expect(within(metricas).getByText('Investimento')).toBeInTheDocument();
    const config = screen.getByRole('region', { name: 'Configuração atual' });
    expect(within(config).getByText('Ativa')).toBeInTheDocument();
    expect(within(config).getByText('Rentabilidade')).toBeInTheDocument();
    expect(within(config).getByText(/R\$\s*10,00/)).toBeInTheDocument();
    expect(within(config).getByText(/5x/)).toBeInTheDocument();
    expect(within(metricas).queryByText(/Orçamento diário/)).toBeNull();
  });

  it('TACOS da conta não aparece no escopo de uma campanha', () => {
    abrir();
    expect(screen.queryByText('TACOS da conta')).toBeNull();
  });

  it('mostra o aviso de composição atual junto dos produtos patrocinados', () => {
    abrir();
    const produtos = screen.getByRole('region', { name: 'Produtos patrocinados atualmente' });
    expect(within(produtos).getByText(/Produtos patrocinados atualmente\. A composição pode ter mudado durante o período\./)).toBeInTheDocument();
    // Tabela (xl) e cartões (abaixo) coexistem no DOM; o CSS escolhe qual aparece.
    expect(within(produtos).getAllByText('Camiseta').length).toBeGreaterThan(0);
  });

  it('campanha fora da leitura atual: configuração indisponível, sem apresentar composição atual', () => {
    abrir({ campanha: null });
    const config = screen.getByRole('region', { name: 'Configuração atual' });
    expect(within(config).getByText(/não está mais entre as campanhas ativas ou pausadas/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Produtos patrocinados atualmente' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Métricas do período' })).toBeInTheDocument();
  });

  it('carregando e erro ficam na seção de métricas', () => {
    hook(undefined, { isLoading: true });
    const { unmount } = abrir();
    expect(screen.getByRole('status', { name: /carregando métricas/i })).toBeInTheDocument();
    unmount();
    hook(undefined, { isError: true, error: new Error('falhou') });
    abrir();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível ler as métricas');
  });

  describe('Anúncios patrocinados', () => {
    it('colunas pedidas, ordenado por investimento e valores calculados das aditivas', () => {
      abrir();
      const cab = within(tabela()).getAllByRole('columnheader').map((h) => h.textContent);
      expect(cab).toEqual(['Anúncio', 'Investimento', 'Impressões', 'Cliques', 'CPC', 'Vendas atribuídas', 'Receita', 'ACOS']);
      expect(ordemIds()[0]).toContain('MLB2');
      const linha = within(tabela()).getByText('Camiseta Azul').closest('tr')!;
      expect(linha).toHaveTextContent('MLB1');
      expect(within(linha).getByText('R$ 1,00')).toBeInTheDocument(); // CPC = 100 / 100
      expect(within(linha).getByText('25,0%')).toBeInTheDocument(); // ACOS = 100 / 400
    });

    it('ordena ao clicar no cabeçalho e expõe aria-sort', async () => {
      const user = userEvent.setup();
      abrir();
      const cab = (n: string) => within(tabela()).getByRole('columnheader', { name: n });
      expect(cab('Investimento')).toHaveAttribute('aria-sort', 'descending');
      await user.click(within(cab('Receita')).getByRole('button'));
      expect(cab('Receita')).toHaveAttribute('aria-sort', 'descending');
      expect(cab('Investimento')).toHaveAttribute('aria-sort', 'none');
      expect(ordemIds()[0]).toContain('MLB1');
      await user.click(within(cab('Receita')).getByRole('button'));
      expect(cab('Receita')).toHaveAttribute('aria-sort', 'ascending');
      expect(ordemIds()[0]).toContain('MLB2');
    });

    // Células na ordem das colunas: 0 Anúncio, 1 Investimento, ..., 6 Receita, 7 ACOS.
    const delta = (linha: HTMLElement, coluna: number) => {
      const el = within(linha).getAllByRole('cell')[coluna].querySelector('[data-delta]') as HTMLElement | null;
      return el && { texto: el.textContent, direcao: el.dataset.direcao, tom: el.dataset.tom };
    };

    it('variação por anúncio: texto, direção e tom de cada métrica', () => {
      abrir();
      const linha = within(tabela()).getByText('Camiseta Azul').closest('tr')!;
      expect(delta(linha, 1)).toEqual({ texto: '+25%', direcao: 'up', tom: 'neutral' }); // 100 vs 80
      expect(delta(linha, 6)).toEqual({ texto: '+100%', direcao: 'up', tom: 'neutral' }); // 400 vs 200
      expect(delta(linha, 7)).toEqual({ texto: '-15,0 p.p.', direcao: 'down', tom: 'success' }); // ACOS 25% vs 40%
    });

    it('comparação provisória: selo Provisória e nenhum tom de sucesso/perigo', () => {
      hook(resposta({ comparacao: { estado: 'provisoria', motivo: null } }));
      abrir();
      const linha = within(tabela()).getByText('Camiseta Azul').closest('tr')!;
      expect(delta(linha, 7)).toEqual({ texto: '-15,0 p.p.', direcao: 'down', tom: 'neutral' });
      expect(within(linha).getAllByText('Provisória').length).toBeGreaterThan(0);
    });

    it('métrica anterior sem valor: mostra o motivo específico, não só "Sem comparação"', () => {
      const anterior = { ...m(80, 200, 3, 1500, 80), cost: { valor: null, motivo: 'fora_da_retencao' } as ValorAds };
      hook(resposta({ anuncios: [anuncio('MLB1', 'Camiseta Azul', m(100, 400, 5, 2000, 100), anterior)] }));
      abrir();
      const linha = within(tabela()).getByText('Camiseta Azul').closest('tr')!;
      const inv = within(linha).getAllByRole('cell')[1];
      expect(inv.querySelector('[data-delta]')).toBeNull();
      expect(inv).toHaveTextContent('Variação indisponível: Período fora da retenção do ML.');
    });

    it('cartões (mobile): controle de direção inverte a ordem', async () => {
      const user = userEvent.setup();
      abrir();
      const cartoes = () => within(screen.getByRole('list', { name: 'Anúncios patrocinados em cartões' })).getAllByRole('listitem').map((li) => li.textContent ?? '');
      expect(cartoes()[0]).toContain('MLB2'); // investimento desc
      await user.click(screen.getByRole('button', { name: /ordem decrescente/i }));
      expect(cartoes()[0]).toContain('MLB1');
      expect(screen.getByRole('button', { name: /ordem crescente/i })).toBeInTheDocument();
    });

    it('atribuição em aberto: marca os dias do gráfico mesmo sem comparação', () => {
      // lido em 08/10: nenhum dos dias 01–07/10 passou de 15 dias.
      hook(resposta({ anterior: null, comparacao: { estado: 'desligada', motivo: null } }));
      abrir();
      expect(screen.getByText(/atribuição ainda em aberto \(7 dias\)/i)).toBeInTheDocument();
    });

    it('atribuição em aberto: só os dias lidos há menos de 15 dias', () => {
      const r = resposta({ comparacao: { estado: 'desligada', motivo: null } });
      r.atual = { ...r.atual!, lidoEm: '2026-10-20T10:00:00Z' }; // 01–05/10 já fechados; 06 e 07 em aberto
      hook(r);
      abrir();
      expect(screen.getByText(/atribuição ainda em aberto \(2 dias\)/i)).toBeInTheDocument();
    });

    it('atribuição toda fechada: sem aviso de dias em aberto', () => {
      const r = resposta();
      r.atual = { ...r.atual!, lidoEm: '2026-11-30T10:00:00Z' };
      hook(r);
      abrir();
      expect(screen.queryByText(/atribuição ainda em aberto/i)).toBeNull();
    });

    it('lista indisponível: mostra o motivo, não uma tabela vazia', () => {
      hook(resposta({ anuncios: null, anunciosMotivo: 'limite_de_leitura' }));
      abrir();
      expect(screen.queryByRole('table', { name: 'Anúncios patrocinados no período' })).toBeNull();
      expect(screen.getByText(/Lista de anúncios indisponível/)).toBeInTheDocument();
      expect(screen.getByText(/Limite de leitura atingido/)).toBeInTheDocument();
    });

    it('anterior null com motivo: valores atuais completos e variação indisponível com o motivo', () => {
      hook(resposta({
        anuncios: [anuncio('MLB1', 'Camiseta Azul', m(100, 400, 5, 2000, 100), null)],
        anunciosMotivo: 'limite_de_leitura',
      }));
      abrir();
      const linha = within(tabela()).getByText('Camiseta Azul').closest('tr')!;
      expect(within(linha).getByText('25,0%')).toBeInTheDocument();
      expect(linha.querySelector('[data-delta]')).toBeNull();
      expect(within(linha).getByText(/Variação indisponível/)).toBeInTheDocument();
      expect(within(linha).getByText(/Limite de leitura atingido/)).toBeInTheDocument();
    });

    it('anúncio sem linha na anterior (motivo nulo): variação indisponível por ser novo no período', () => {
      hook(resposta({ anuncios: [anuncio('MLB1', null, m(100, 400, 5, 2000, 100), null)], anunciosMotivo: null }));
      abrir();
      expect(within(tabela()).getByText(/Sem dados no período anterior/)).toBeInTheDocument();
    });

    it('lista vazia: mensagem própria', () => {
      hook(resposta({ anuncios: [] }));
      abrir();
      expect(screen.getByText(/Nenhum anúncio patrocinado com dados no período/)).toBeInTheDocument();
    });

    it('sem comparação pedida: nenhuma variação nem aviso de indisponível', () => {
      hook(resposta({ anterior: null, comparacao: { estado: 'desligada', motivo: null }, anuncios: [anuncio('MLB1', null, m(100, 400, 5, 2000, 100), null)] }));
      abrir();
      expect(screen.queryByText(/Variação indisponível/)).toBeNull();
    });
  });
});
