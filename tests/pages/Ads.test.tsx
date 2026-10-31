import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { PainelAds } from '@/lib/ads-painel';
import type { RetornoAdsPainel } from '@/hooks/useAdsPainel';
import { PERIODO_PADRAO_ADS } from '@/lib/ads-painel-dados';
import type { BlocoAdsMetricas, PedidoAdsMetricas, RespostaAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAdsPainel', () => ({ useAdsPainel: hook }));
const hookCampanhas = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAdsCampanhas', () => ({ useAdsCampanhas: hookCampanhas }));
const hookMetricas = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAdsMetricas', () => ({ useAdsMetricas: hookMetricas }));
// Em jsdom o ResponsiveContainer fica 0x0: tamanho fixo para o gráfico existir.
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 280 } as never),
}));
import Ads from '@/pages/Ads';
import { ResumoConta } from '@/components/ads/resumo-conta';
import { AVISO } from '@/components/ads/aviso';

const metr = { cliques: 0, impressoes: 0 };
const PAINEL: PainelAds = {
  estado: 'ok', desatualizado: false, gruposCobertos: true, semaforoLiberado: true, contaMotivo: null,
  conta: { ...metr, custo: 100, vendasDiretas: 700, vendasTotais: 800, roas: 8, roasDireto: 7, acos: 0.125,
    lucroAntes: 300, resultado: 200, margemConsumida: 1 / 3, fonteCusto: 'real',
    emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3, divergente: false, diasAbertos: 0 },
  familias: [
    { ...metr, codigoPai: 'A', nome: 'Fam A', grupos: 1, custoCompartilhado: 0, custo: 50, vendasDiretas: 400,
      vendasTotais: 500, roas: 10, roasDireto: 8, acos: 0.1, acosDireto: 0.125, lucroAntes: 250, resultado: 200,
      margemConsumida: 0.2, acosEquilibrio: 0.25, semaforo: 'dentro', motivo: null, fonteCusto: 'real', markup: 0.8 },
    { ...metr, codigoPai: 'B', nome: 'Fam B', grupos: 1, custoCompartilhado: 0, custo: 30, vendasDiretas: 0,
      vendasTotais: 0, roas: 0, roasDireto: 0, acos: null, acosDireto: null, lucroAntes: 0, resultado: -30,
      margemConsumida: null, acosEquilibrio: null, semaforo: null, motivo: 'sem_vendas', fonteCusto: null, markup: null },
  ],
  compartilhados: [{ id: 9, custo: 20, familias: ['A', 'B'], semCodigo: 0 }],
  conciliacao: { estado: 'ok' },
};
const bloco = (resumo: BlocoAdsMetricas['resumo'] = {}): BlocoAdsMetricas => ({
  janela: { desde: '2026-09-04', ate: '2026-10-03' }, resumo, serie: [], completo: true, lidoEm: '2026-10-04T12:00:00Z',
});
const respostaMetricas = (extra: Partial<RespostaAdsMetricas> = {}): RespostaAdsMetricas => ({
  ok: true, estado: 'ok', escopo: 'conta', atual: bloco(), anterior: null, campanhas: [],
  comparacao: { estado: 'desligada', motivo: null },
  disponibilidade: { desde: '2026-04-01', ate: '2026-10-03', fuso: 'America/Sao_Paulo' }, avisos: [], ...extra,
});
/** Mostra a URL atual (aba/período/comparação vivem nela). */
function Local() {
  const l = useLocation();
  return <output data-testid="local">{l.search}</output>;
}
const montar = (
  painel: PainelAds | null = PAINEL,
  extra: Partial<RetornoAdsPainel> = {},
  // Os testes de Desempenho fixam a aba; os da aba inicial passam null (nenhuma escolha guardada).
  abaGuardada: 'desempenho' | 'campanhas' | null = 'desempenho',
  url = '/ads',
) => {
  try { if (abaGuardada) localStorage.setItem('ads-aba', abaGuardada); } catch { /* storage bloqueado no teste */ }
  const retorno: RetornoAdsPainel = {
    painel,
    // O resultado da conta não espera os grupos; nos testes ele parte da conta do painel.
    resultadoConta: painel?.conta ? { conta: painel.conta, motivo: null } : null,
    janela: { desde: '2026-09-04', ate: '2026-10-03' },
    situacaoPeriodo: 'pronto',
    historicoDesde: '2026-01-01T03:00:00.000Z',
    ultimoOkEm: '2026-10-04T14:17:00Z',
    comparacao: null,
    metricasConta: null,
    faturamentoConta: null,
    blocos: { conta: { isLoading: false, isError: false }, grupos: { isLoading: false, isError: false },
      sync: { isLoading: false, isError: false } },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    atualizar: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };

  hook.mockReturnValue(retorno);
  return render(<MemoryRouter initialEntries={[url]}><Ads /><Local /></MemoryRouter>);
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  hook.mockReset();
  hookCampanhas.mockReset();
  hookMetricas.mockReset();
  hookMetricas.mockReturnValue({ data: undefined, isLoading: true, isFetching: false, isError: false, error: null, refetch: vi.fn() });
  hookCampanhas.mockReturnValue({
    resposta: null, campanhas: null, isLoading: true, isError: false, erro: null, atualizando: false, atualizar: vi.fn(), erroAtualizar: null, tentarDeNovo: vi.fn(),
  });
});
afterEach(() => vi.restoreAllMocks());

const campanhaPeriodo = (extra: Partial<RespostaAdsMetricas['campanhas'][number]> = {}) => ({
  id: 7, nome: 'Camp Verão', statusAtual: 'active', atual: bloco({ cost: { valor: 50, motivo: null } }), anterior: null, ...extra,
});
/** Métricas por escopo: 'campanhas' devolve a tabela do período; os demais escopos seguem carregando. */
const comCampanhas = (campanhas = [campanhaPeriodo()]) => hookMetricas.mockImplementation((p: PedidoAdsMetricas | null) => (
  p?.escopo === 'campanhas'
    ? { data: respostaMetricas({ escopo: 'campanhas', atual: null, campanhas }), isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() }
    : { data: undefined, isLoading: true, isFetching: false, isError: false, error: null, refetch: vi.fn() }
));
const local = () => new URLSearchParams(screen.getByTestId('local').textContent ?? '');

describe('Ads', () => {
  it('resumo da conta com as 3 parcelas da despesa e o resultado', () => {
    montar();
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByText('Resultado após Ads')).toBeInTheDocument();
    expect(resumo.getByText(/não é o lucro causado pelo Ads/)).toBeVisible();
    fireEvent.click(resumo.getByRole('button', { name: 'Composição do gasto' }));
    expect(resumo.getByText('Gasto de Ads não identificado')).toBeVisible();
    expect(screen.getAllByText(/R\$\s?200,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Despesa informada pela API de Ads/)).toBeInTheDocument();
  });
  describe('linha-resumo do resultado (primeira dobra)', () => {
    const linha = () => within(screen.getByTestId('linha-resultado'));
    it('vem antes da faixa "Conta inteira" e mostra o resultado com cor só com custo real', () => {
      montar({ ...PAINEL, conta: { ...PAINEL.conta!, resultado: -40 } },
        { resultadoConta: { conta: { ...PAINEL.conta!, resultado: -40 }, motivo: null } });
      const el = screen.getByTestId('linha-resultado');
      expect(el.compareDocumentPosition(screen.getByRole('heading', { name: 'Conta inteira' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(linha().getByText('Resultado após Ads')).toBeInTheDocument();
      expect(linha().getByText(/40,00/)).toHaveClass('text-danger');
    });
    it('custo parcial: rótulo parcial, sem cor de interpretação', () => {
      const conta = { ...PAINEL.conta!, resultado: -40, fonteCusto: 'parcial' as const };
      montar({ ...PAINEL, conta }, { resultadoConta: { conta, motivo: null } });
      expect(linha().getByText('Resultado parcial após Ads')).toBeInTheDocument();
      expect(linha().getByText(/40,00/)).not.toHaveClass('text-danger');
      expect(linha().getByText(/só com as vendas com custo cadastrado/)).toBeVisible();
    });
    it('custo estimado: selo Estimado', () => {
      const conta = { ...PAINEL.conta!, fonteCusto: 'estimado' as const };
      montar({ ...PAINEL, conta }, { resultadoConta: { conta, motivo: null } });
      expect(linha().getByText('Estimado')).toBeInTheDocument();
    });
    it('indisponível: travessão e motivo, sem número', () => {
      const conta = { ...PAINEL.conta!, resultado: null, fonteCusto: null };
      montar({ ...PAINEL, conta }, { resultadoConta: { conta, motivo: null } });
      expect(linha().getByText(/Resultado indisponível: /)).toBeVisible();
    });
    it('atalho em Desempenho filtra o ranking e rola até ele; em Campanhas não há atalho na linha', () => {
      const rolar = vi.fn();
      Element.prototype.scrollIntoView = rolar;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0; });
      montar({ ...PAINEL, familias: [PAINEL.familias[0], { ...PAINEL.familias[1], semaforo: 'acima' as const, acosEquilibrio: 0.2 }] });
      fireEvent.click(linha().getByRole('button', { name: 'Ver famílias acima do equilíbrio' }));
      expect(rolar).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' })).toHaveAttribute('aria-pressed', 'true');
      const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
      expect(tabela.queryByRole('row', { name: /Fam A/ })).not.toBeInTheDocument();
      expect(tabela.getByRole('row', { name: /Fam B/ })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Ver famílias acima do equilíbrio' })).toHaveLength(1);
    });
    it('em Campanhas a linha existe sem o atalho', () => {
      comCampanhas();
      montar({ ...PAINEL, familias: [PAINEL.familias[0], { ...PAINEL.familias[1], semaforo: 'acima' as const, acosEquilibrio: 0.2 }] }, {}, 'campanhas');
      expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('linha-resultado')).toBeInTheDocument();
      expect(linha().queryByRole('button')).not.toBeInTheDocument();
    });
  });
  it('ranking por gasto com semáforo e link para o dossiê da família', () => {
    montar();
    const linhaA = screen.getByRole('row', { name: /Fam A/ });
    expect(within(linhaA).getByText(/dentro/i)).toBeInTheDocument();
    expect(within(linhaA).getByRole('link', { name: /Fam A/ })).toHaveAttribute('href', '/faturamento/sku/familia/A');
    expect(within(screen.getByRole('row', { name: /Fam B/ })).getByText(/sem vendas no período/i)).toBeInTheDocument();
  });
  it('selo provisório quando há dias em atribuição em aberto', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, diasAbertos: 14 } });
    expect(screen.getByText(/provisório/i)).toBeInTheDocument();
  });
  it('composição indisponível (coleta sem cobertura) mantém o resultado da conta e o ranking', () => {
    montar({ ...PAINEL, conta: null, contaMotivo: 'cobertura' }, { resultadoConta: { conta: PAINEL.conta!, motivo: null } });
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByRole('group', { name: 'Resultado após Ads' })).toHaveTextContent(/R\$\s*200,00/);
    expect(resumo.queryByRole('button', { name: 'Composição do gasto' })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
  });
  // C3: composição só com grupos cobertos e conciliação ok — senão mistura investimento ao vivo com grupos não conciliados.
  it.each([
    ['conciliação pendente', { conciliacao: { estado: 'pendente' as const, mensagem: 'pendente', coletadoEm: null, coletada: null, coletadaMotivo: 'cobertura' as const } }],
    ['grupos sem cobertura', { gruposCobertos: false, conciliacao: { estado: 'pendente' as const, mensagem: 'pendente', coletadoEm: null, coletada: null, coletadaMotivo: 'cobertura' as const } }],
    ['sem conciliação', { conciliacao: null }],
  ])('%s: sem "Composição do gasto" mesmo com a conta ao vivo montada', (_n, extra) => {
    montar({ ...PAINEL, ...extra });
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByRole('group', { name: 'Resultado após Ads' })).toHaveTextContent(/R\$\s*200,00/);
    expect(resumo.queryByRole('button', { name: 'Composição do gasto' })).not.toBeInTheDocument();
  });
  it('trocar o período chama o hook com o preset estruturado', () => {
    localStorage.setItem('ads-painel-dias', '30');
    montar();

    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'preset', dias: 30 });

    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));

    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'preset', dias: 7 });
  });
  it('família com gasto compartilhado: resultado indisponível com o motivo', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], custoCompartilhado: 20, resultado: null, semaforo: null, motivo: 'compartilhado' }] });
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/gasto compartilhado com outra família/i)).toBeInTheDocument();
  });
  it('mostra desde quando há vendas; com histórico incompleto, lucro e resultado não aparecem', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, lucroAntes: null, resultado: null, fonteCusto: null },
      familias: [{ ...PAINEL.familias[0], lucroAntes: null, resultado: null, motivo: 'historico' }] },
    { historicoDesde: '2026-09-10T15:00:00.000Z' });
    expect(screen.getByText(/Vendas desde/)).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/antes do histórico de vendas/i)).toBeInTheDocument();
  });
  it('conta divergente: mostra o aviso e não mostra o não identificado', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, divergente: true, naoIdentificado: null, naoIdentificadoPct: null } });
    expect(screen.getByText(/não fecha com o total da conta/i)).toBeInTheDocument();
    expect(screen.queryByText('Gasto de Ads não identificado')).not.toBeInTheDocument();
  });
  it('sem anunciante: aviso e nenhum número', () => {
    montar({ ...PAINEL, estado: 'sem_advertiser', conta: null, familias: [], compartilhados: [] });
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
    expect(screen.getByText(/anunciante/i)).toBeInTheDocument();
  });
  it('revela a composição sob demanda', () => {
    montar();
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));

    expect(resumo.getByText('Despesa de Ads')).toBeVisible();
    expect(resumo.getByText('Resultado após Ads')).toBeVisible();
    expect(resumo.getByText('Em famílias')).not.toBeVisible();
    const botao = resumo.getByRole('button', { name: 'Composição do gasto' });
    expect(document.getElementById(botao.getAttribute('aria-controls')!)).toBeInTheDocument();

    fireEvent.click(resumo.getByRole('button', { name: 'Composição do gasto' }));

    expect(resumo.getByText('Em famílias')).toBeVisible();
    expect(resumo.getByText('Compartilhado entre famílias')).toBeVisible();
    expect(resumo.getByText('Gasto de Ads não identificado')).toBeVisible();
  });

  it.each([
    [null, 'período antes do histórico de vendas (desde 10/09/2026)'],
    ['sem_custo', 'sem custo cadastrado'],
  ] as const)('explica resultado nulo com fonte %s e oculta a ponte', (fonteCusto, motivo) => {
    montar({
      ...PAINEL,
      conta: { ...PAINEL.conta!, lucroAntes: null, resultado: null, fonteCusto },
    }, { historicoDesde: '2026-09-10T15:00:00.000Z' });

    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    const resultado = resumo.getByRole('group', { name: 'Resultado após Ads' });

    expect(resultado).toHaveTextContent('—');
    expect(resultado).toHaveTextContent(motivo);
    expect(resultado).not.toHaveTextContent(/R\$\s*0,00/);
    expect(resumo.queryByRole('group', { name: 'Cálculo do resultado' }))
      .not.toBeInTheDocument();
    expect(resumo.queryByRole('img', { name: /margem/ })).not.toBeInTheDocument();
  });

  it('barra da margem com lucro positivo e legenda da despesa', () => {
    montar();
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByRole('img', { name: 'Ads consumiu 33,3% da margem; resultado 66,7%' })).toBeInTheDocument();
    expect(resumo.getByRole('group', { name: 'Despesa de Ads' })).toHaveTextContent('33,3% da margem');
  });

  it('Ads maior que a margem: barra cheia em perigo e resultado negativo com sinal', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, lucroAntes: 50, resultado: -50, margemConsumida: 2 } });
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    const barra = resumo.getByRole('img', { name: 'Ads consumiu mais que a margem (200,0%)' });
    expect(barra.children).toHaveLength(1);
    expect(barra.firstElementChild).toHaveClass('bg-danger', 'w-full');
    const valor = within(resumo.getByRole('group', { name: 'Resultado após Ads' })).getByText(/−R\$\s*50,00/);
    expect(valor).toHaveClass('text-danger');
  });

  it('lucro ≤ 0 nunca desenha a barra, mesmo com margem preenchida', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, lucroAntes: -10, resultado: -110, margemConsumida: 0.5 } });
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByRole('group', { name: 'Cálculo do resultado' })).toBeInTheDocument();
    expect(resumo.queryByRole('img', { name: /margem/ })).not.toBeInTheDocument();
  });

  it('lucro conhecido sem margem positiva: ponte sem barra', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, lucroAntes: 0, resultado: -100, margemConsumida: null } });
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByRole('group', { name: 'Cálculo do resultado' })).toBeInTheDocument();
    expect(resumo.queryByRole('img', { name: /margem/ })).not.toBeInTheDocument();
    expect(resumo.getByRole('group', { name: 'Despesa de Ads' })).toHaveTextContent('despesa informada pela API de Ads');
  });

  it.each([['parcial', 'Resultado parcial após Ads'], ['estimado', 'Estimado']] as const)(
    'custo %s fica marcado no resumo com composição fechada',
    (fonteCusto, marca) => {
      montar({ ...PAINEL, conta: { ...PAINEL.conta!, fonteCusto } });

      const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));

      expect(resumo.getByText(marca)).toBeVisible();
      // M4: "O que é" do resultado parcial; os termos da ponte têm o seu, fora do rótulo do grupo.
      if (fonteCusto === 'parcial') expect(resumo.getByRole('button', { name: 'O que é Resultado parcial após Ads' })).toBeInTheDocument();
      for (const t of ['Lucro antes de Ads', 'Despesa de Ads']) {
        expect(resumo.getByRole('button', { name: `O que é ${t}` })).toBeInTheDocument();
        expect(resumo.getByRole('group', { name: t })).toBeInTheDocument();
      }
      expect(resumo.getByRole('button', { name: 'Composição do gasto' }))
        .toHaveAttribute('aria-expanded', 'false');
    },
  );

  it('mantém provisório e divergência visíveis antes da expansão', () => {
    montar({
      ...PAINEL,
      conta: {
        ...PAINEL.conta!,
        diasAbertos: 14,
        divergente: true,
        naoIdentificado: null,
        naoIdentificadoPct: null,
      },
    });

    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));

    expect(resumo.getByText('provisório: 14 dias com atribuição em aberto'))
      .toBeVisible();
    expect(screen.getByText(/não fecha com o total da conta/)).toBeVisible();
    expect(resumo.getByRole('button', { name: 'Composição do gasto' }))
      .toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(resumo.getByRole('button', { name: 'Composição do gasto' }));

    expect(resumo.queryByText('Gasto de Ads não identificado')).not.toBeInTheDocument();
    expect(resumo.getByRole('group', { name: 'Despesa de Ads' }))
      .toHaveTextContent(/R\$\s*100,00/);
    expect(resumo.getByRole('group', { name: 'Resultado após Ads' }))
      .toHaveTextContent(/200,00/);
  });

  it('ponte usa os valores do domínio quando o lucro é conhecido', () => {
    montar();
    const ponte = screen.getByRole('group', { name: 'Cálculo do resultado' });
    expect(ponte).toHaveTextContent(/R\$\s*300,00/);
    expect(ponte).toHaveTextContent(/R\$\s*100,00/);
  });

  it.each([7, 30, 90] as const)('preserva a preferência existente de %i dias', dias => {
    localStorage.setItem('ads-painel-dias', String(dias));
    montar();
    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'preset', dias });
  });

  it.each([null, '', '31', '0', '030', 'range', '{"tipo":"mes_atual"}'])(
    'usa o padrão para preferência inválida %s',
    valor => {
      if (valor !== null) localStorage.setItem('ads-painel-dias', valor);
      montar();
      expect(hook.mock.calls.at(-1)?.[0]).toEqual(PERIODO_PADRAO_ADS);
    },
  );

  it('salva e restaura mês atual na chave existente', () => {
    const primeira = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Mês atual' }));

    expect(localStorage.getItem('ads-painel-dias')).toBe('mes_atual');
    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'mes_atual' });

    primeira.unmount();
    montar();

    expect(screen.getByRole('button', { name: 'Mês atual' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('permite selecionar período com storage bloqueado', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    montar();

    expect(hook.mock.calls.at(-1)?.[0]).toEqual(PERIODO_PADRAO_ADS);

    fireEvent.click(screen.getByRole('button', { name: 'Mês atual' }));

    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'mes_atual' });
    expect(screen.getByRole('button', { name: 'Mês atual' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('mês aguardando oferece os últimos 30 dias sem apresentar números', () => {
    localStorage.setItem('ads-painel-dias', 'mes_atual');
    montar(null, { janela: null, situacaoPeriodo: 'aguardando_mes' });

    expect(screen.getByText('Aguardando o primeiro dia de Ads deste mês'))
      .toBeVisible();
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver últimos 30 dias' }));

    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'preset', dias: 30 });
    expect(localStorage.getItem('ads-painel-dias')).toBe('30');
  });

  it('mostra o intervalo completo em BRT', () => {
    montar();
    expect(screen.getByText('04/09/2026 a 03/10/2026 · BRT')).toBeVisible();
  });

  it.each(['sem_permissao', 'sem_acesso'] as const)(
    '%s oferece Canais sem apresentar resultado',
    estado => {
      montar({ ...PAINEL, estado, conta: null, familias: [], compartilhados: [] });

      expect(screen.getByRole('link', { name: 'Abrir Canais' }))
        .toHaveAttribute('href', '/configuracoes/canais');
      expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
    },
  );

  it('erro oferece uma nova consulta', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar(null, { isError: true, refetch });

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('erro do sync mostra o alerta, não o skeleton', () => {
    montar(null, { janela: null, situacaoPeriodo: 'carregando', isError: true, ultimoOkEm: null });

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar as vendas do período.');
    expect(screen.queryByLabelText('Carregando')).not.toBeInTheDocument();
  });

  it('aguardando_mes não mostra skeleton', () => {
    montar(null, { janela: null, situacaoPeriodo: 'aguardando_mes', isLoading: false });

    expect(screen.getByText('Aguardando o primeiro dia de Ads deste mês')).toBeVisible();
    expect(screen.queryByLabelText('Carregando')).not.toBeInTheDocument();
  });

  it('refetch mantém os dados da mesma janela visíveis', () => {
    montar(PAINEL, { isFetching: true });

    expect(screen.getByText('Atualizando…')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Resumo da conta' }))
      .toBeInTheDocument();
  });

  it('sem_ads oferece os últimos 90 dias', () => {
    montar({ ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] });

    expect(screen.getByText('Sem investimento em Ads neste período')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver últimos 90 dias' }));

    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'preset', dias: 90 });
  });

  it('sem_ads com 90 dias selecionado não repete a ação', () => {
    localStorage.setItem('ads-painel-dias', '90');
    montar({ ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] });

    expect(screen.getByText('Sem investimento em Ads neste período')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ver últimos 90 dias' })).not.toBeInTheDocument();
  });

  it.each(['sem_coleta', 'coletando'] as const)('%s permite verificar novamente', estado => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar({ ...PAINEL, estado, conta: null, familias: [], compartilhados: [] }, { refetch });

    fireEvent.click(screen.getByRole('button', { name: 'Verificar novamente' }));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
  });

  it('compartilhado e não identificado ficam em Gastos associados, fora das famílias', () => {
    montar();
    const associados = within(screen.getByRole('region', { name: 'Gastos associados' }));
    expect(associados.getByRole('button', { name: /Compartilhado entre famílias/ })).toBeInTheDocument();
    expect(associados.getByText(/R\$\s*20,00/)).toBeInTheDocument();
    expect(associados.getByText('Gasto de Ads não identificado')).toBeInTheDocument();
    expect(associados.getByText(/R\$\s*30,00/)).toBeInTheDocument();
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    expect(tabela.queryByRole('row', { name: /Compartilhado|não identificado/ })).not.toBeInTheDocument();
    expect(tabela.getAllByRole('columnheader')[1]).toHaveTextContent('Investimento');
  });
  it('ordem total / direto em toda a tela', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Composição do gasto' }));
    fireEvent.click(within(screen.getByRole('row', { name: /Fam A/ })).getByRole('button', { name: 'Ver detalhes de Fam A' }));
    expect(screen.queryByText(/direta? \/ total/)).not.toBeInTheDocument();
    // Resumo usa ROAS + "direto" (ordem coberta no teste dos indicadores); a frase fica só no detalhe da família.
    expect(screen.getAllByText(/ROAS \(total \/ direto\)/)).toHaveLength(1);
  });
  it('sem família com gasto: mensagem em vez de tabela vazia', () => {
    montar({ ...PAINEL, conta: null, contaMotivo: 'cobertura', familias: [], compartilhados: [] });
    expect(screen.getByText('Nenhum gasto de Ads por família no período.')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Famílias por gasto' })).not.toBeInTheDocument();
  });
  it('grupo sem família (só anúncio sem código): rótulo "sem código identificado"', () => {
    montar({ ...PAINEL, compartilhados: [{ id: 7, custo: 2.02, familias: [], semCodigo: 1 }] });
    const associados = within(screen.getByRole('region', { name: 'Gastos associados' }));
    fireEvent.click(associados.getByRole('button', { name: /Compartilhado entre famílias/ }));
    expect(associados.getByText(/Grupo 7: sem código identificado \(1 anúncio\)/)).toBeInTheDocument();
    expect(screen.queryByText(/sem família \+/)).not.toBeInTheDocument();
  });
  it('motivo histórico com a data da 1ª venda', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], lucroAntes: null, resultado: null, motivo: 'historico' }] },
      { historicoDesde: '2026-08-03T15:00:00.000Z' });
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/antes do histórico de vendas \(desde 03\/08\/2026\)/)).toBeInTheDocument();
  });

  it('os cartões de contagem filtram sem alterar gastos associados', () => {
    montar({
      ...PAINEL,
      familias: [
        PAINEL.familias[0],
        { ...PAINEL.familias[1], semaforo: 'acima', acosEquilibrio: 0.2 },
      ],
    });

    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    const associados = screen.getByRole('region', { name: 'Gastos associados' });
    const antes = associados.textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Acima do equilíbrio' }));

    expect(tabela.queryByRole('row', { name: /Fam A/ })).not.toBeInTheDocument();
    expect(tabela.getByRole('row', { name: /Fam B/ })).toBeInTheDocument();
    expect(associados.textContent).toBe(antes);
    expect(screen.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('zero acima do equilíbrio mostra frase sem botão de atenção', () => {
    montar();

    expect(screen.queryByRole('button', { name: /Filtrar por Acima do equilíbrio/ }))
      .not.toBeInTheDocument();
    expect(screen.getByText(
      'Nenhuma família avaliável acima do equilíbrio. Há famílias sem referência.',
    )).toBeVisible();
  });

  it('sem referência por histórico diz desde quando e o que fazer', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], lucroAntes: null, resultado: null, acosEquilibrio: null,
      semaforo: null, motivo: 'historico' }] }, { historicoDesde: '2026-10-05T15:00:00.000Z' });

    expect(screen.getByText(
      'Sem referência: histórico de vendas só desde 05/10/2026. Escolha um período a partir de 06/10/2026.',
    )).toBeVisible();
  });

  it('zero em atenção com todas avaliáveis tem a frase própria', () => {
    montar({ ...PAINEL, familias: [PAINEL.familias[0]] });

    expect(screen.getByText('Nenhuma família acima do equilíbrio neste período.')).toBeVisible();
    // Dentro e Sem referência ficam sempre visíveis, mesmo com zero (§2.3); só Acima do equilíbrio some.
    expect(screen.getByRole('button', { name: 'Filtrar por Sem referência' })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: 'Filtrar por Dentro do equilíbrio' })).toHaveTextContent('1');
  });

  it('sem venda direta tem texto explícito e preserva o semáforo', () => {
    montar({
      ...PAINEL,
      familias: [{
        ...PAINEL.familias[0],
        vendasDiretas: 0,
        acosDireto: null,
        acosEquilibrio: 0.25,
        semaforo: 'acima',
      }],
    });

    const linha = within(screen.getByRole('row', { name: /Fam A/ }));

    expect(linha.getByText('sem venda direta')).toBeVisible();
    expect(linha.getByText('25,0%')).toBeVisible();
    expect(linha.getByText('Acima do equilíbrio')).toBeVisible();
    expect(linha.queryByTestId('barra-uso-margem')).not.toBeInTheDocument();
  });

  it.each(['parcial', 'estimado'] as const)(
    'família mantém custo %s no resultado fechado',
    fonteCusto => {
      montar({
        ...PAINEL,
        familias: [{
          ...PAINEL.familias[0],
          fonteCusto,
          motivo: fonteCusto === 'parcial' ? 'custo_parcial' : null,
          semaforo: fonteCusto === 'parcial' ? null : 'dentro',
        }],
      });

      const linha = within(screen.getByRole('row', { name: /Fam A/ }));
      const resultado = linha.getByRole('group', { name: 'Resultado após Ads' });

      expect(resultado).toHaveTextContent(
        fonteCusto === 'parcial' ? 'custo parcial: sem semáforo' : 'custo estimado',
      );
      expect(linha.getByRole('button', { name: 'Ver detalhes de Fam A' }))
        .toHaveAttribute('aria-expanded', 'false');
    },
  );

  it('resultado bloqueado conserva travessão e motivo', () => {
    montar({
      ...PAINEL,
      familias: [{
        ...PAINEL.familias[0],
        resultado: null,
        custoCompartilhado: 20,
        semaforo: null,
        motivo: 'compartilhado',
      }],
    });

    const linha = within(screen.getByRole('row', { name: /Fam A/ }));
    const resultado = linha.getByRole('group', { name: 'Resultado após Ads' });

    expect(resultado).toHaveTextContent('—');
    expect(resultado).toHaveTextContent('gasto compartilhado com outra família');
    expect(screen.getByRole('row', { name: /Fam A/ })).not.toHaveTextContent(/R\$\s*0,00/);
  });

  it('custo parcial com outro motivo mostra os dois sem prometer semáforo', () => {
    montar({
      ...PAINEL,
      familias: [{
        ...PAINEL.familias[0],
        resultado: null,
        custoCompartilhado: 20,
        semaforo: null,
        motivo: 'compartilhado',
        fonteCusto: 'parcial',
      }],
    });

    const resultado = within(screen.getByRole('row', { name: /Fam A/ }))
      .getByRole('group', { name: 'Resultado após Ads' });

    expect(resultado).toHaveTextContent('custo parcial');
    expect(resultado).toHaveTextContent('gasto compartilhado com outra família');
    expect(resultado).not.toHaveTextContent('sem semáforo');
  });

  it('semáforo desligado não pinta o filtro Dentro do equilíbrio de sucesso', () => {
    montar({ ...PAINEL, semaforoLiberado: false, familias: [{ ...PAINEL.familias[0], semaforo: null }] });

    const filtro = screen.getByRole('button', { name: 'Filtrar por Dentro do equilíbrio' });
    expect(within(filtro).getByText('Dentro do equilíbrio')).not.toHaveClass('text-success');
  });

  it('conta divergente marca as linhas com a indicação curta', () => {
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, divergente: true, naoIdentificado: null, naoIdentificadoPct: null } });

    const resultado = within(screen.getByRole('row', { name: /Fam A/ })).getByRole('group', { name: 'Resultado após Ads' });
    expect(resultado).toHaveTextContent('Composição da conta divergente');
    expect(resultado).toHaveTextContent(/R\$\s*200,00/);
    expect(screen.getAllByText(/não fecha com o total da conta/)).toHaveLength(1);
  });

  it('expande métricas secundárias e preserva o link do nome', () => {
    montar();

    const linha = within(screen.getByRole('row', { name: /Fam A/ }));
    const botao = linha.getByRole('button', { name: 'Ver detalhes de Fam A' });

    fireEvent.click(botao);

    expect(botao).toHaveAttribute('aria-expanded', 'true');

    const id = botao.getAttribute('aria-controls');
    if (!id) throw new Error('Expansão sem aria-controls');

    const detalhe = document.getElementById(id);
    if (!detalhe) throw new Error('Conteúdo da expansão não encontrado');

    expect(within(detalhe).getByText('ROAS (total / direto)')).toBeVisible();
    expect(within(detalhe).getByText('Vendas atribuídas (total / direta)'))
      .toBeVisible();
    expect(linha.getByRole('link', { name: /Fam A/ }))
      .toHaveAttribute('href', '/faturamento/sku/familia/A');
  });

  it('detalhe informa o não identificado sem ratear', () => {
    montar();
    const botao = within(screen.getByRole('row', { name: /Fam A/ }))
      .getByRole('button', { name: 'Ver detalhes de Fam A' });
    fireEvent.click(botao);
    const detalhe = document.getElementById(botao.getAttribute('aria-controls') ?? '');
    if (!detalhe) throw new Error('Conteúdo da expansão não encontrado');
    expect(within(detalhe).getByText(
      '30,0% do gasto da conta não tem família identificada e não foi rateado entre famílias.',
    )).toBeVisible();
  });

  // Minor pré-merge: cartões (mobile/tablet) também ordenam — coluna + direção, alvos de 44 px em toque.
  it('cartões: controle de direção inverte a ordem e o seletor oferece as colunas', () => {
    montar();
    const nomes = () => within(screen.getByRole('list', { name: 'Famílias por gasto em cartões' }))
      .getAllByRole('listitem').map(li => li.textContent ?? '');
    expect(nomes()[0]).toContain('Fam A'); // investimento desc: 50 > 30
    const direcao = screen.getByRole('button', { name: /ordem decrescente/i });
    expect(direcao).toHaveClass('max-sm:h-11', 'pointer-coarse:h-11');
    fireEvent.click(direcao);
    expect(nomes()[0]).toContain('Fam B');
    expect(screen.getByRole('combobox', { name: 'Ordenar famílias por' })).toHaveTextContent('Investimento');
  });

  it('cartão e linha usam ids de expansão distintos', () => {
    montar();
    const lista = within(screen.getByRole('list', { name: 'Famílias por gasto em cartões' }));
    const botaoCartao = lista.getByRole('button', { name: 'Ver detalhes de Fam A' });
    const botaoLinha = within(screen.getByRole('row', { name: /Fam A/ }))
      .getByRole('button', { name: 'Ver detalhes de Fam A' });
    expect(botaoCartao.getAttribute('aria-controls')).toBeTruthy();
    expect(botaoCartao.getAttribute('aria-controls')).not.toBe(botaoLinha.getAttribute('aria-controls'));
  });

  it('semáforo em validação tem uma única mensagem', () => {
    montar({
      ...PAINEL,
      semaforoLiberado: false,
      familias: [{ ...PAINEL.familias[0], semaforo: null }],
    });

    expect(screen.getByText(/Semáforo em validação:/)).toBeVisible();
    expect(screen.getAllByText(/Semáforo em validação:/)).toHaveLength(1);
    expect(within(screen.getByRole('row', { name: /Fam A/ }))
      .queryByText('Dentro do equilíbrio')).not.toBeInTheDocument();
  });

  it('trocar o período reinicia filtro e detalhes; refetch da mesma janela preserva', () => {
    const familias = [PAINEL.familias[0], { ...PAINEL.familias[1], semaforo: 'acima' as const, acosEquilibrio: 0.2 }];
    const view = montar({ ...PAINEL, familias });
    const ultimo = (): RetornoAdsPainel => hook.mock.results.at(-1)?.value;

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Acima do equilíbrio' }));
    fireEvent.click(within(screen.getByRole('row', { name: /Fam B/ }))
      .getByRole('button', { name: 'Ver detalhes de Fam B' }));

    // Refetch da mesma janela: filtro e detalhe permanecem.
    hook.mockReturnValue({ ...ultimo(), isFetching: true });
    view.rerender(<MemoryRouter><Ads /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('table', { name: 'Famílias por gasto' }))
      .getByRole('button', { name: 'Ver detalhes de Fam B' })).toHaveAttribute('aria-expanded', 'true');

    // Troca de período: volta a todas, detalhes fechados.
    hook.mockReturnValue({ ...ultimo(), isFetching: false, janela: { desde: '2026-09-27', ate: '2026-10-03' } });
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(screen.queryByRole('button', { name: 'Remover filtro Acima do equilíbrio' })).not.toBeInTheDocument();
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    expect(tabela.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
    expect(tabela.getByRole('button', { name: 'Ver detalhes de Fam B' })).toHaveAttribute('aria-expanded', 'false');
  });
  it('card com contagem 0 fica desabilitado, exceto Todas', () => {
    montar({ ...PAINEL, familias: [PAINEL.familias[0]] });

    const semRef = screen.getByRole('button', { name: 'Filtrar por Sem referência' });
    expect(semRef).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(semRef);
    expect(semRef).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filtrar por Dentro do equilíbrio' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Remover filtro Todas' })).not.toHaveAttribute('aria-disabled');
  });

  it('filtro ativo sem família mostra vazio com Ver todas', () => {
    const view = montar();
    const ultimo = (): RetornoAdsPainel => hook.mock.results.at(-1)?.value;
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Dentro do equilíbrio' }));

    // Refetch da mesma janela preserva o filtro, mas a família saiu de "dentro".
    const familias = [{ ...PAINEL.familias[0], semaforo: 'acima' as const }, PAINEL.familias[1]];
    hook.mockReturnValue({ ...ultimo(), painel: { ...PAINEL, familias } });
    view.rerender(<MemoryRouter><Ads /></MemoryRouter>);

    expect(screen.getByText('Nenhuma família neste filtro no período.')).toBeVisible();
    expect(screen.queryByRole('table', { name: 'Famílias por gasto' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
    expect(screen.queryByText('Nenhuma família neste filtro no período.')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
  });

  it('nome da família tem title com o nome completo na tabela e no cartão', () => {
    montar();

    const links = screen.getAllByRole('link', { name: 'Fam A' });
    expect(links).toHaveLength(2);
    for (const l of links) expect(l).toHaveAttribute('title', 'Fam A');
  });

  it('uso da margem: barra proporcional ao ACOS direto sobre o equilíbrio', () => {
    montar();
    const linha = within(screen.getByRole('row', { name: /Fam A/ }));
    expect(linha.getByText('12,5%')).toBeVisible();
    const barra = linha.getByTestId('barra-uso-margem');
    expect(barra).toHaveStyle({ width: '50%' });
    expect(barra).toHaveClass('bg-success');
  });

  it('uso da margem acima do equilíbrio: barra cheia e vermelha', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], acosDireto: 0.4, semaforo: 'acima' }] });
    const barra = within(screen.getByRole('row', { name: /Fam A/ })).getByTestId('barra-uso-margem');
    expect(barra).toHaveStyle({ width: '100%' });
    expect(barra).toHaveClass('bg-danger');
  });

  it('uso da margem sem semáforo: texto sem barra, mesmo com equilíbrio e venda direta', () => {
    montar({ ...PAINEL, semaforoLiberado: false, familias: [{ ...PAINEL.familias[0], semaforo: null }] });
    const linha = within(screen.getByRole('row', { name: /Fam A/ }));
    expect(linha.getByText('12,5%')).toBeVisible();
    expect(linha.getByText('25,0%')).toBeVisible();
    expect(linha.queryByTestId('barra-uso-margem')).not.toBeInTheDocument();
  });

  it('uso da margem sem referência: texto sem barra', () => {
    montar();
    const linha = within(screen.getByRole('row', { name: /Fam B/ }));
    expect(linha.getByText(/sem referência/)).toBeVisible();
    expect(linha.queryByTestId('barra-uso-margem')).not.toBeInTheDocument();
  });

  it('(i) das colunas explica como ler ACOS direto e Equilíbrio observado', () => {
    montar();
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    fireEvent.click(tabela.getByRole('button', { name: 'O que é ACOS direto' }));
    expect(screen.getByText(/de cada R\$ 100 vendidos/)).toBeVisible();
    fireEvent.click(tabela.getByRole('button', { name: 'O que é Equilíbrio observado' }));
    expect(screen.getByText(/margem antes de Ads nas vendas desta família/)).toBeVisible();
  });

  it('(i) nas colunas Família, Investimento e Resultado após Ads', () => {
    montar();
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    fireEvent.click(tabela.getByRole('button', { name: 'O que é Família' }));
    expect(screen.getByText(/código PAI/)).toBeVisible();
    fireEvent.click(tabela.getByRole('button', { name: 'O que é Investimento' }));
    expect(screen.getByText(/grupos de anúncios exclusivos dela/)).toBeVisible();
    fireEvent.click(tabela.getByRole('button', { name: 'O que é Resultado após Ads' }));
    expect(screen.getByText(/Não é o lucro causado pelo Ads/)).toBeVisible();
  });

  it('detalhe mostra o markup antes de Ads', () => {
    montar();
    fireEvent.click(within(screen.getByRole('row', { name: /Fam A/ })).getByRole('button', { name: 'Ver detalhes de Fam A' }));
    const linha = screen.getAllByText('Markup antes de Ads')[0].closest('div')!;
    expect(within(linha).getByText('+80%')).toBeInTheDocument();
  });

  describe('tabela de familias', () => {
    const tresFamilias = () => ({
      ...PAINEL,
      familias: [
        PAINEL.familias[0],
        { ...PAINEL.familias[1], codigoPai: 'B', nome: 'Fam B', custo: 90, vendasDiretas: 100, acosDireto: 0.4,
          acosEquilibrio: 0.2, semaforo: 'acima' as const, motivo: null, resultado: -5, fonteCusto: 'real' as const },
        { ...PAINEL.familias[1], codigoPai: 'C', nome: 'Zeta C' },
      ],
    });
    const nomesDasLinhas = () => within(screen.getByRole('table', { name: 'Famílias por gasto' }))
      .getAllByRole('row').slice(1).map(r => r.textContent?.match(/Fam [A-Z]|Zeta C/)?.[0]);

    it('cabeçalhos ACOS direto e Equilíbrio observado substituem a frase "Ads X% de Y% possíveis"', () => {
      montar();
      const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
      const cabecas = tabela.getAllByRole('columnheader').map(c => c.textContent);
      expect(cabecas[1]).toContain('Investimento');
      expect(cabecas[2]).toContain('ACOS direto');
      expect(cabecas[3]).toContain('Equilíbrio observado');
      expect(screen.queryByText(/possíveis/)).not.toBeInTheDocument();
      const linha = within(screen.getByRole('row', { name: /Fam A/ }));
      expect(linha.getByText('12,5%')).toBeVisible();
      expect(linha.getByText('25,0%')).toBeVisible();
    });

    it('busca filtra as linhas por nome ou código e mostra vazio com limpar', () => {
      montar(tresFamilias());
      const busca = screen.getByRole('searchbox', { name: /Buscar família/ });
      fireEvent.change(busca, { target: { value: 'zeta' } });
      expect(nomesDasLinhas()).toEqual(['Zeta C']);
      fireEvent.change(busca, { target: { value: 'b' } });
      expect(nomesDasLinhas()).toEqual(['Fam B']);
      fireEvent.change(busca, { target: { value: 'nada' } });
      expect(screen.queryByRole('table', { name: 'Famílias por gasto' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ver todas' }));
      expect(nomesDasLinhas()).toHaveLength(3);
    });

    it('ordenação por coluna usa aria-sort e alterna a direção', () => {
      montar(tresFamilias());
      const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
      const th = (n: RegExp) => tabela.getAllByRole('columnheader').find(c => n.test(c.textContent ?? ''))!;
      expect(th(/Investimento/)).toHaveAttribute('aria-sort', 'descending');
      expect(nomesDasLinhas()).toEqual(['Fam B', 'Fam A', 'Zeta C']);
      fireEvent.click(within(th(/Investimento/)).getByRole('button', { name: 'Investimento' }));
      expect(th(/Investimento/)).toHaveAttribute('aria-sort', 'ascending');
      expect(nomesDasLinhas()).toEqual(['Zeta C', 'Fam A', 'Fam B']);
      fireEvent.click(within(th(/Família/)).getByRole('button', { name: 'Família' }));
      expect(th(/Família/)).toHaveAttribute('aria-sort', 'ascending');
      expect(th(/Investimento/)).toHaveAttribute('aria-sort', 'none');
      expect(nomesDasLinhas()).toEqual(['Fam A', 'Fam B', 'Zeta C']);
    });

    it('motivos de indisponível continuam visíveis na linha', () => {
      montar(tresFamilias());
      const linha = within(screen.getByRole('row', { name: /Zeta C/ }));
      expect(linha.getByText('sem vendas no período')).toBeVisible();
      expect(linha.getByText('sem venda direta')).toBeVisible();
      expect(linha.getByText('sem referência')).toBeVisible();
    });

    it('filtro Acima do equilíbrio mostra só as acima, com contagem independente da busca', () => {
      montar(tresFamilias());
      const botao = screen.getByRole('button', { name: 'Filtrar por Acima do equilíbrio' });
      expect(botao).toHaveTextContent('1');
      fireEvent.click(botao);
      expect(nomesDasLinhas()).toEqual(['Fam B']);
      expect(within(screen.getByRole('row', { name: /Fam B/ })).getByText('Acima do equilíbrio')).toBeVisible();
      fireEvent.change(screen.getByRole('searchbox', { name: /Buscar família/ }), { target: { value: 'zeta' } });
      expect(screen.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' })).toHaveTextContent('1');
    });
  });

  describe('tabela de familias sem espaço', () => {
    it('sem espaço para Ads conta e filtra como acima do equilíbrio, mantendo o selo', () => {
      const semEspaco = { ...PAINEL.familias[0], codigoPai: 'S', nome: 'Fam S', custo: 50, vendasDiretas: 100,
        acosDireto: 0.5, acosEquilibrio: -0.1, semaforo: 'sem_espaco' as const, resultado: -60 };
      montar({ ...PAINEL, familias: [PAINEL.familias[0], semEspaco] });
      const botao = screen.getByRole('button', { name: 'Filtrar por Acima do equilíbrio' });
      expect(botao).toHaveTextContent('1');
      expect(screen.queryByText('Nenhuma família acima do equilíbrio neste período.')).not.toBeInTheDocument();
      fireEvent.click(botao);
      const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
      expect(tabela.queryByRole('row', { name: /Fam A/ })).not.toBeInTheDocument();
      expect(within(tabela.getByRole('row', { name: /Fam S/ })).getByText('Sem espaço para Ads')).toBeVisible();
    });
  });

  describe('abas Desempenho | Campanhas', () => {
    const dadosOk = (campanhas: unknown[] = []) => ({
      resposta: { ok: true, estado: 'ok', lidoEm: '2026-10-20T15:05:00Z', aliquotasConfirmadas: true, projecaoLimitada: false,
        publicadosPorFamilia: {}, campanhas: [], anuncios: [] },
      campanhas, isLoading: false, isError: false, erro: null, atualizando: false, atualizar: vi.fn(), erroAtualizar: null, tentarDeNovo: vi.fn(),
    });

    it('renderiza as duas abas', () => {
      montar();
      expect(screen.getByRole('tab', { name: 'Desempenho' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Campanhas/ })).toBeInTheDocument();
    });

    it('painel ok sem escolha guardada abre em Desempenho e só busca campanhas na outra aba', () => {
      montar(PAINEL, {}, null);
      expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');
      expect(hookCampanhas).toHaveBeenLastCalledWith(false);
    });

    it('sem_ads sem escolha guardada abre em Campanhas e busca', () => {
      montar({ ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] }, {}, null);
      expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
      expect(hookCampanhas).toHaveBeenLastCalledWith(true);
    });

    it.each(['sem_coleta', 'coletando'] as const)('%s abre em Campanhas', estado => {
      montar({ ...PAINEL, estado, conta: null, familias: [], compartilhados: [] }, {}, null);
      expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('aguardando_mes abre em Campanhas', () => {
      montar(null, { situacaoPeriodo: 'aguardando_mes' }, null);
      expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('com o painel ainda carregando não decide nem pisca', () => {
      montar(null, { situacaoPeriodo: 'carregando', isLoading: true }, null);
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('a escolha guardada vence a regra do estado', () => {
      montar({ ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] }, {}, 'desempenho');
      expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');
    });

    it('trocar de aba guarda a escolha em ads-aba', () => {
      montar();
      fireEvent.mouseDown(screen.getByRole('tab', { name: /Campanhas/ }));
      expect(localStorage.getItem('ads-aba')).toBe('campanhas');
    });

    it('o seletor de período vale para as duas abas', () => {
      montar(PAINEL, {}, 'campanhas');
      expect(screen.getByRole('group', { name: 'Período' })).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Desempenho' }));
      expect(screen.getByRole('group', { name: 'Período' })).toBeInTheDocument();
    });

    it('sem_ads oferece Ver campanhas, que troca de aba', () => {
      montar({ ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] });
      fireEvent.click(screen.getByRole('button', { name: 'Ver campanhas' }));
      expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('selo da aba com o número de famílias em alerta', () => {
      hookCampanhas.mockReturnValue(dadosOk([
        { id: 1, familias: [{ alertas: ['roas_acima_margem'] }, { alertas: [] }, { alertas: ['patrocinado_parado'] }] },
      ]));
      montar();
      expect(screen.getByText('2 famílias em alerta')).toBeInTheDocument();
    });

    it('Ver desempenho de uma família (no detalhe da campanha) abre o detalhe dela no ranking', () => {
      const fam = { codigoPai: 'A', nome: 'Fam A', anuncios: [], equilibrioPct: 25, motivoEquilibrio: null,
        patrocinados: 1, publicados: 1, alertas: [] };
      hookCampanhas.mockReturnValue(dadosOk([{ id: 7, nome: 'Camp Verão', status: 'active', estrategia: null,
        roasObjetivo: null, acosObjetivo: null, orcamentoDiario: null, familias: [fam], foraDoPubliai: [], totalAlertas: 0 }]));
      comCampanhas();
      montar(PAINEL, {}, 'campanhas');
      fireEvent.click(screen.getAllByRole('button', { name: 'Ver campanha Camp Verão' })[0]);
      fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Ver anúncios de Fam A' })[0]);
      fireEvent.click(screen.getAllByRole('button', { name: 'Ver desempenho' })[0]);
      expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');
      expect(within(screen.getAllByRole('row', { name: /Fam A/ })[0]).getByRole('button', { name: 'Ver detalhes de Fam A' }))
        .toHaveAttribute('aria-expanded', 'true');
    });

    it('família sem linha no painel não tem o link Ver desempenho', () => {
      const fam = { codigoPai: 'Z', nome: 'Fam Z', anuncios: [], equilibrioPct: 25, motivoEquilibrio: null,
        patrocinados: 1, publicados: 1, alertas: [] };
      hookCampanhas.mockReturnValue(dadosOk([{ id: 7, nome: 'Camp Verão', status: 'active', estrategia: null,
        roasObjetivo: null, acosObjetivo: null, orcamentoDiario: null, familias: [fam], foraDoPubliai: [], totalAlertas: 0 }]));
      comCampanhas();
      montar(PAINEL, {}, 'campanhas');
      fireEvent.click(screen.getAllByRole('button', { name: 'Ver campanha Camp Verão' })[0]);
      fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Ver anúncios de Fam Z' })[0]);
      expect(screen.queryByRole('button', { name: 'Ver desempenho' })).not.toBeInTheDocument();
    });
  });
});

describe('resultado da conta após Ads', () => {
  const resumo = () => within(screen.getByRole('region', { name: 'Resumo da conta' }));
  const comConta = (c: Partial<NonNullable<PainelAds['conta']>>) => ({ ...PAINEL, conta: { ...PAINEL.conta!, ...c } });

  it('resultado completo: rótulo simples, sem marca de parcial ou estimado', () => {
    montar();
    const r = resumo().getByRole('group', { name: 'Resultado após Ads' });
    expect(r).toHaveTextContent(/R\$\s*200,00/);
    expect(resumo().queryByText(/parcial/i)).not.toBeInTheDocument();
    expect(resumo().queryByText('Estimado')).not.toBeInTheDocument();
  });

  it('resultado parcial: rótulo próprio e nenhum rótulo de resultado completo', () => {
    montar(comConta({ fonteCusto: 'parcial' }));
    expect(resumo().getByRole('group', { name: 'Resultado parcial após Ads' })).toHaveTextContent(/R\$\s*200,00/);
    expect(resumo().queryByRole('group', { name: 'Resultado após Ads' })).not.toBeInTheDocument();
    expect(resumo().getByText(/só com as vendas com custo cadastrado/)).toBeVisible();
  });

  it('resultado estimado: marca "Estimado" e sem cor de interpretação', () => {
    montar(comConta({ fonteCusto: 'estimado', lucroAntes: 50, resultado: -50, margemConsumida: 2 }));
    const r = resumo().getByRole('group', { name: 'Resultado após Ads' });
    expect(resumo().getByText('Estimado')).toBeVisible();
    expect(within(r).getByText(/−R\$\s*50,00/)).not.toHaveClass('text-danger');
    // Base incompleta: a barra da margem também fica neutra (plano §4.7).
    const barra = resumo().getByRole('img', { name: /Ads consumiu mais que a margem/ });
    expect(barra.firstElementChild).not.toHaveClass('bg-danger');
    expect(barra.parentElement!.innerHTML).not.toMatch(/bg-danger/);
  });

  it.each([
    ['fiscal', { motivoFiscal: 'nao_confirmada' }, 'Resultado indisponível: confirme as alíquotas em Configurações.'],
    ['histórico', { fonteCusto: null }, 'Resultado indisponível: período antes do histórico de vendas (desde 01/01/2026).'],
    ['sem custo', { fonteCusto: 'sem_custo' }, 'Resultado indisponível: sem custo cadastrado.'],
  ] as const)('resultado indisponível por %s tem texto próprio e nenhum zero', (_n, extra, texto) => {
    montar(comConta({ lucroAntes: null, resultado: null, ...extra } as never));
    const r = resumo().getByRole('group', { name: 'Resultado após Ads' });
    expect(r).toHaveTextContent('—');
    expect(r).toHaveTextContent(texto);
    expect(r).not.toHaveTextContent(/R\$\s*0,00/);
  });

  it.each([
    ['serie_incompleta', 'Resultado indisponível: a leitura ao vivo do ML veio incompleta neste período.'],
    ['catalogo', 'Resultado indisponível: o catálogo não carregou, então o custo dos produtos é desconhecido.'],
  ] as const)('sem conta (%s): motivo explícito', (motivo, texto) => {
    render(<ResumoConta conta={null} motivo={motivo} historicoDesde={null} faturamentoConta={null} />);
    expect(screen.getByText(texto)).toBeVisible();
    expect(screen.getByText(/não é o lucro causado pelo Ads/)).toBeVisible();
  });

  it('ressalva causal fica visível em qualquer estado', () => {
    montar(comConta({ lucroAntes: null, resultado: null, fonteCusto: null }));
    expect(resumo().getByText('Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.')).toBeVisible();
  });

  it('atalho "Ver famílias acima do equilíbrio" chama onVerAcima', () => {
    const onVerAcima = vi.fn();
    render(<ResumoConta conta={PAINEL.conta!} historicoDesde={null} faturamentoConta={1000} onVerAcima={onVerAcima} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver famílias acima do equilíbrio' }));
    expect(onVerAcima).toHaveBeenCalledTimes(1);
  });

  it('equilíbrio observado da conta: lucro antes ÷ faturamento, neutro e sem comparar com o ACOS', () => {
    render(<ResumoConta conta={PAINEL.conta!} historicoDesde={null} faturamentoConta={1000} />);
    const eq = screen.getByRole('group', { name: 'Equilíbrio observado da conta' });
    expect(eq).toHaveTextContent('30,0%');
    expect(eq).toHaveTextContent(/referência do mix/i);
    expect(eq.innerHTML).not.toMatch(/success|danger|warning/);
    expect(eq).not.toHaveTextContent(/acima|abaixo|dentro/i);
  });

  it.each([
    ['custo parcial', { fonteCusto: 'parcial' as const }, 1000],
    ['sem faturamento', {}, null],
  ])('equilíbrio indisponível com %s', (_n, extra, fat) => {
    render(<ResumoConta conta={{ ...PAINEL.conta!, ...extra }} historicoDesde={null} faturamentoConta={fat} />);
    expect(screen.getByRole('group', { name: 'Equilíbrio observado da conta' })).toHaveTextContent('—');
  });
});

describe('contexto único: período, comparação e aba', () => {
  const familiasAcima = { ...PAINEL, familias: [PAINEL.familias[0], { ...PAINEL.familias[1], semaforo: 'acima' as const, acosEquilibrio: 0.2 }] };

  it('trocar de aba preserva datas e comparação, e a URL guarda os três', () => {
    comCampanhas();
    montar(PAINEL, {}, 'desempenho', '/ads?comparar=nenhum');
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Campanhas/ }));

    expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Comparar com' })).toHaveTextContent('Sem comparação');
    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'preset', dias: 7 });
    expect(hookMetricas).toHaveBeenCalledWith(
      expect.objectContaining({ escopo: 'campanhas', desde: '2026-09-04', ate: '2026-10-03', comparar: 'nenhum' }), true);
    expect(Object.fromEntries(local())).toEqual({ periodo: '7', comparar: 'nenhum', aba: 'campanhas' });
  });

  it('reload restaura aba, período personalizado e comparação da URL, acima da preferência antiga', () => {
    localStorage.setItem('ads-painel-dias', '90');
    comCampanhas();
    montar(PAINEL, {}, 'desempenho', '/ads?aba=campanhas&periodo=range&desde=2026-09-10&ate=2026-09-20&comparar=nenhum');

    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'range', desde: '2026-09-10', ate: '2026-09-20' });
    expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Personalizado/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Comparar com' })).toHaveTextContent('Sem comparação');
  });

  it('período inválido na URL mostra o motivo em vez de outra janela', () => {
    montar(null, { janela: null, situacaoPeriodo: 'invalido' }, 'desempenho', '/ads?periodo=range&desde=2026-10-20&ate=2026-10-01');
    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'range', desde: '2026-10-20', ate: '2026-10-01' });
    expect(screen.getByText(/Período inválido/)).toBeVisible();
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
  });

  it('seleção explícita de aba não é desfeita por resposta tardia', () => {
    const view = montar(null, { situacaoPeriodo: 'carregando', janela: null }, null);
    const ultimo = (): RetornoAdsPainel => hook.mock.results.at(-1)?.value;
    const rerender = (p: Partial<RetornoAdsPainel>) => {
      hook.mockReturnValue({ ...ultimo(), ...p });
      view.rerender(<MemoryRouter><Ads /></MemoryRouter>);
    };
    rerender({ painel: PAINEL, situacaoPeriodo: 'pronto' });
    expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Campanhas/ }));
    rerender({ painel: { ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] } });
    expect(screen.getByRole('tab', { name: /Campanhas/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Desempenho' }));
    rerender({ painel: null, situacaoPeriodo: 'carregando' });
    rerender({ painel: { ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] }, situacaoPeriodo: 'pronto' });
    expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Campanhas mostra os KPIs da conta inteira, o resultado da conta e a tabela do período', () => {
    comCampanhas();
    montar(PAINEL, { metricasConta: respostaMetricas({ atual: bloco({ cost: { valor: 100, motivo: null } }) }) }, 'campanhas');

    const conta = within(screen.getByRole('region', { name: 'Conta inteira' }));
    expect(conta.getByText('Conta inteira')).toBeVisible();
    expect(conta.getByText('Investimento').closest('[data-kpi]')).toHaveTextContent(/R\$\s*100,00/);
    expect(screen.getByRole('heading', { name: 'Resultado da conta após Ads' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Campanhas no período' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Camp Verão/ })).toHaveTextContent(/R\$\s*50,00/);
    expect(screen.queryByText(/resultado das campanhas/i)).not.toBeInTheDocument();
  });

  it('abrir uma campanha abre o detalhe com métricas do período e configuração atual', () => {
    comCampanhas();
    montar(PAINEL, {}, 'campanhas');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver campanha Camp Verão' })[0]);

    const detalhe = within(screen.getByRole('dialog'));
    expect(detalhe.getByRole('heading', { name: 'Camp Verão' })).toBeInTheDocument();
    expect(detalhe.getByText('Métricas do período')).toBeInTheDocument();
    expect(detalhe.getByText('Competitividade')).toBeInTheDocument();
    expect(detalhe.getByText('Configuração atual')).toBeInTheDocument();
    expect(hookMetricas).toHaveBeenCalledWith(expect.objectContaining({ escopo: 'campanha', campanhaId: 7 }), true);
  });

  it('atalho do resultado filtra as famílias acima do equilíbrio, maior investimento primeiro', () => {
    montar(familiasAcima);
    fireEvent.click(screen.getByRole('button', { name: 'Ver famílias acima do equilíbrio' }));

    expect(screen.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' })).toHaveAttribute('aria-pressed', 'true');
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    expect(tabela.queryByRole('row', { name: /Fam A/ })).not.toBeInTheDocument();
    expect(tabela.getByRole('row', { name: /Fam B/ })).toBeInTheDocument();
    expect(tabela.getAllByRole('columnheader').find(c => /Investimento/.test(c.textContent ?? '')))
      .toHaveAttribute('aria-sort', 'descending');
  });

  it('atalho a partir de Campanhas volta para Desempenho já filtrado', () => {
    comCampanhas();
    montar(familiasAcima, {}, 'campanhas');
    fireEvent.click(screen.getByRole('button', { name: 'Ver famílias acima do equilíbrio' }));

    expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Remover filtro Acima do equilíbrio' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('período inválido sem aba guardada nem na URL mostra o motivo (não fica em "Abrindo o Ads…")', () => {
    montar(null, { janela: null, situacaoPeriodo: 'invalido' }, null, '/ads?periodo=range&desde=2026-10-20&ate=2026-10-01');
    expect(screen.getByText('Período inválido')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Período' })).toBeInTheDocument();
    expect(screen.queryByText('Abrindo o Ads…')).not.toBeInTheDocument();
  });

  it('range malformado na URL vai ao resolvedor como veio, sem cair noutra janela', () => {
    localStorage.setItem('ads-painel-dias', '30');
    montar(null, { janela: null, situacaoPeriodo: 'invalido' }, 'desempenho', '/ads?periodo=range&desde=foo&ate=2026-10-20');
    expect(hook.mock.calls.at(-1)?.[0]).toEqual({ tipo: 'range', desde: 'foo', ate: '2026-10-20' });
    expect(hook.mock.calls.map(c => c[0])).not.toContainEqual({ tipo: 'preset', dias: 30 });
    expect(screen.getByText('Informe datas válidas nos dois campos.')).toBeVisible();
  });

  it('divergência da composição aparece uma vez também em Campanhas', () => {
    comCampanhas();
    montar({ ...PAINEL, conta: { ...PAINEL.conta!, divergente: true, naoIdentificado: null, naoIdentificadoPct: null } }, {}, 'campanhas');
    expect(screen.getAllByText(/não fecha com o total da conta/)).toHaveLength(1);
  });

  it('Atualizar do cabeçalho em Campanhas refaz conta, tabela do período e configuração (fresco)', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const atualizarPainel = vi.fn().mockResolvedValue(undefined);
    const refetchCampanhas = vi.fn().mockResolvedValue(undefined);
    const atualizarCampanhas = vi.fn().mockResolvedValue(undefined);
    const atualizar = vi.fn().mockResolvedValue(undefined);
    hookCampanhas.mockReturnValue({ resposta: null, campanhas: null, isLoading: true, isError: false, erro: null,
      atualizando: false, atualizar, erroAtualizar: null, tentarDeNovo: vi.fn() });
    hookMetricas.mockImplementation((p: PedidoAdsMetricas | null) => ({
      data: p?.escopo === 'campanhas' ? respostaMetricas({ escopo: 'campanhas', atual: null, campanhas: [campanhaPeriodo()] }) : undefined,
      isLoading: false, isFetching: false, isError: false, error: null,
      refetch: p?.escopo === 'campanhas' ? refetchCampanhas : vi.fn(), atualizar: p?.escopo === 'campanhas' ? atualizarCampanhas : vi.fn(),
    }));
    montar(PAINEL, { refetch, atualizar: atualizarPainel }, 'campanhas');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(atualizarPainel).toHaveBeenCalledTimes(1);
    expect(atualizarCampanhas).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(refetchCampanhas).not.toHaveBeenCalled();
  });

  // C2: falha ao atualizar (ex.: 429) com a tabela já lida não a apaga; "Tentar novamente" sem dado é consulta normal.
  it('erro ao atualizar as campanhas com tabela lida mantém a tabela, com aviso', () => {
    hookMetricas.mockImplementation((p: PedidoAdsMetricas | null) => (p?.escopo === 'campanhas'
      ? { data: respostaMetricas({ escopo: 'campanhas', atual: null, campanhas: [campanhaPeriodo()] }), isLoading: false,
        isFetching: false, isError: true, error: new Error('Atualização recente.'), refetch: vi.fn(), atualizar: vi.fn() }
      : { data: undefined, isLoading: true, isFetching: false, isError: false, error: null, refetch: vi.fn(), atualizar: vi.fn() }));
    montar(PAINEL, {}, 'campanhas');
    expect(screen.getByRole('row', { name: /Camp Verão/ })).toBeInTheDocument();
    expect(screen.getByText(/Não foi possível atualizar as campanhas agora/)).toBeInTheDocument();
  });

  it('erro sem tabela lida: Tentar novamente refaz a consulta normal', () => {
    const refetchCampanhas = vi.fn();
    const atualizarCampanhas = vi.fn();
    hookMetricas.mockImplementation((p: PedidoAdsMetricas | null) => (p?.escopo === 'campanhas'
      ? { data: undefined, isLoading: false, isFetching: false, isError: true, error: new Error('x'), refetch: refetchCampanhas, atualizar: atualizarCampanhas }
      : { data: undefined, isLoading: true, isFetching: false, isError: false, error: null, refetch: vi.fn(), atualizar: vi.fn() }));
    montar(PAINEL, {}, 'campanhas');
    const alerta = screen.getByText('Não foi possível ler as campanhas do período no Mercado Livre.').closest('[role=alert]') as HTMLElement;
    fireEvent.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }));
    expect(refetchCampanhas).toHaveBeenCalledTimes(1);
    expect(atualizarCampanhas).not.toHaveBeenCalled();
  });

  it('Campanhas termina com a integridade e a procedência da conta', () => {
    comCampanhas();
    montar(PAINEL, {}, 'campanhas');
    expect(screen.getByRole('region', { name: 'Integridade dos números' })).toBeInTheDocument();
  });

  it('sem família acima do equilíbrio não oferece o atalho', () => {
    montar();
    expect(screen.queryByRole('button', { name: 'Ver famílias acima do equilíbrio' })).not.toBeInTheDocument();
  });
});

describe('estados: sem gasto e falhas parciais', () => {
  const SEM_ADS = { ...PAINEL, estado: 'sem_ads' as const, conta: null, familias: [], compartilhados: [] };
  const okMetricas = (p: PedidoAdsMetricas | null) => ({
    data: p?.escopo === 'campanhas' ? respostaMetricas({ escopo: 'campanhas', atual: null, campanhas: [campanhaPeriodo()] }) : undefined,
    isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(),
  });

  it('estados: zero confirmado mostra investimento zero e as campanhas', () => {
    hookMetricas.mockImplementation(okMetricas);
    montar(SEM_ADS, { metricasConta: respostaMetricas({ atual: bloco({ cost: { valor: 0, motivo: null } }) }) });

    expect(screen.getByText('Sem investimento em Ads neste período')).toBeVisible();
    expect(screen.getByText('Suas campanhas continuam disponíveis.')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Conta inteira' })).getByText('Investimento').closest('[data-kpi]')).toHaveTextContent(/R\$\s*0,00/);
    expect(within(screen.getByRole('region', { name: 'Conta inteira' })).getByText('ROAS').closest('[data-kpi]')).toHaveTextContent('Indisponível');

    fireEvent.click(screen.getByRole('button', { name: 'Ver campanhas' }));
    expect(screen.getByRole('row', { name: /Camp Verão/ })).toBeInTheDocument();
  });

  it('estados: falha da configuração não apaga as métricas do período', () => {
    hookMetricas.mockImplementation(okMetricas);
    hookCampanhas.mockReturnValue({ resposta: null, campanhas: null, isLoading: false, isError: true, erro: new Error('ML'),
      atualizando: false, atualizar: vi.fn(), erroAtualizar: null, tentarDeNovo: vi.fn() });
    montar(PAINEL, { metricasConta: respostaMetricas({ atual: bloco({ cost: { valor: 100, motivo: null } }) }) }, 'campanhas');

    expect(within(screen.getByRole('region', { name: 'Conta inteira' })).getByText('Investimento').closest('[data-kpi]')).toHaveTextContent(/R\$\s*100,00/);
    expect(screen.getByRole('row', { name: /Camp Verão/ })).toBeInTheDocument();
    expect(screen.getByText(/Configuração atual indisponível/)).toBeInTheDocument();
  });

  it('estados: coleta recusada antiga não bloqueia a leitura ao vivo válida', () => {
    hookMetricas.mockImplementation(okMetricas);
    montar({ ...PAINEL, estado: 'sem_permissao', conta: null, familias: [], compartilhados: [] },
      { metricasConta: respostaMetricas({ atual: bloco({ cost: { valor: 100, motivo: null } }) }) });

    const conta = within(screen.getByRole('region', { name: 'Conta inteira' }));
    expect(conta.getByText('Investimento').closest('[data-kpi]')).toHaveTextContent(/R\$\s*100,00/);
    // O aviso da coleta fica só no bloco das famílias, uma vez.
    expect(screen.getAllByText(AVISO.sem_permissao!)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Abrir Canais' })).toHaveAttribute('href', '/configuracoes/canais');

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Campanhas/ }));
    expect(screen.getByRole('row', { name: /Camp Verão/ })).toBeInTheDocument();
    expect(screen.queryByText(AVISO.sem_permissao!)).not.toBeInTheDocument();
  });

  // I5: o aviso de comparação provisória é texto visível, não só `title` (hover).
  it('comparação provisória: microcopy visível no contexto', () => {
    montar(PAINEL, { comparacao: { tipo: 'pronta', janela: { desde: '2026-08-05', ate: '2026-09-03' } }, metricasConta: respostaMetricas({
      atual: bloco({ cost: { valor: 100, motivo: null } }), comparacao: { estado: 'provisoria', motivo: 'x' } }) });
    expect(screen.getByText('Comparação provisória: o ML ainda pode revisar a atribuição de vendas.')).toBeVisible();
  });

  it('estados: falha da comparação não apaga o período atual', () => {
    montar(PAINEL, { comparacao: { tipo: 'pronta', janela: { desde: '2026-08-05', ate: '2026-09-03' } }, metricasConta: respostaMetricas({
      atual: bloco({ cost: { valor: 100, motivo: null } }), anterior: null,
      comparacao: { estado: 'indisponivel', motivo: 'o ML não respondeu o período anterior' },
    }) });

    expect(within(screen.getByRole('region', { name: 'Conta inteira' })).getByText('Investimento').closest('[data-kpi]')).toHaveTextContent(/R\$\s*100,00/);
    expect(screen.getByText('Comparação indisponível: o ML não respondeu o período anterior')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Resumo da conta' })).toBeInTheDocument();
  });

  it('estados: grupos com erro não apagam a conta e oferecem Tentar novamente', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar(null, { refetch, resultadoConta: { conta: PAINEL.conta!, motivo: null },
      blocos: { conta: { isLoading: false, isError: false }, grupos: { isLoading: false, isError: true },
        sync: { isLoading: false, isError: false } } }, null);

    expect(screen.getByRole('tab', { name: 'Desempenho' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Resumo da conta' })).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar as famílias do período.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('estados: leitura da conta com erro mostra Tentar novamente, que refaz a consulta', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar(PAINEL, { refetch, metricasConta: null,
      blocos: { conta: { isLoading: false, isError: true }, grupos: { isLoading: false, isError: false },
        sync: { isLoading: false, isError: false } } });

    expect(screen.getByText('Não foi possível ler as métricas da conta no Mercado Livre.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  // Minor pré-merge: falha ao atualizar com leitura anterior em mãos mantém os valores e avisa com o horário.
  it('estados: atualização da conta falha com dados anteriores → valores mantidos, aviso com horário e Tentar novamente', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar(PAINEL, { refetch, metricasConta: respostaMetricas({ atual: bloco({ cost: { valor: 42, motivo: null } }) }),
      blocos: { conta: { isLoading: false, isError: true }, grupos: { isLoading: false, isError: false },
        sync: { isLoading: false, isError: false } } });

    expect(screen.getByRole('region', { name: 'Resumo da conta' })).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s*42,00/).length).toBeGreaterThan(0);
    const aviso = screen.getByRole('alert');
    expect(aviso).toHaveTextContent('Não foi possível atualizar a conta agora; os valores exibidos são da leitura das 09:00.');
    fireEvent.click(within(aviso).getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem_conexao', 'sem_acesso', true],
    ['sem_advertiser', 'sem_advertiser', false],
    ['sem_permissao', 'sem_permissao', true],
  ] as const)('estados: %s tem um aviso só, com o caminho de recuperação, nas duas abas', (estado, estadoPainel, canais) => {
    hookMetricas.mockImplementation((p: PedidoAdsMetricas | null) => ({
      data: respostaMetricas({ estado, escopo: p?.escopo ?? 'conta', atual: null }),
      isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(),
    }));
    hookCampanhas.mockReturnValue({ resposta: { ok: true, estado }, campanhas: [], isLoading: false, isError: false, erro: null,
      atualizando: false, atualizar: vi.fn(), erroAtualizar: null, tentarDeNovo: vi.fn() });
    montar({ ...PAINEL, estado: estadoPainel, conta: null, familias: [], compartilhados: [] },
      { metricasConta: respostaMetricas({ estado, atual: null }), resultadoConta: null }, 'desempenho');

    const verificar = () => {
      expect(screen.getAllByText(AVISO[estado]!)).toHaveLength(1);
      if (estadoPainel !== estado) expect(screen.queryAllByText(AVISO[estadoPainel]!)).toHaveLength(0);
      expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
      if (canais) expect(screen.getByRole('link', { name: 'Abrir Canais' })).toHaveAttribute('href', '/configuracoes/canais');
      else expect(screen.queryByRole('link', { name: 'Abrir Canais' })).not.toBeInTheDocument();
    };
    verificar();
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Campanhas/ }));
    verificar();
  });
});
