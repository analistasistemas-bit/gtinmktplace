import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PainelAds } from '@/lib/ads-painel';
import type { RetornoAdsPainel } from '@/hooks/useAdsPainel';
import { PERIODO_PADRAO_ADS } from '@/lib/ads-painel-dados';

const hook = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useAdsPainel', () => ({ useAdsPainel: hook }));
import Ads from '@/pages/Ads';

const metr = { cliques: 0, impressoes: 0 };
const PAINEL: PainelAds = {
  estado: 'ok', desatualizado: false, gruposCobertos: true, semaforoLiberado: true, contaMotivo: null,
  conta: { ...metr, custo: 100, vendasDiretas: 700, vendasTotais: 800, roas: 8, roasDireto: 7, acos: 0.125,
    lucroAntes: 300, resultado: 200, margemConsumida: 1 / 3, fonteCusto: 'real',
    emFamilias: 50, compartilhado: 20, naoIdentificado: 30, naoIdentificadoPct: 0.3, divergente: false, diasAbertos: 0 },
  familias: [
    { ...metr, codigoPai: 'A', nome: 'Fam A', grupos: 1, custoCompartilhado: 0, custo: 50, vendasDiretas: 400,
      vendasTotais: 500, roas: 10, roasDireto: 8, acos: 0.1, acosDireto: 0.125, lucroAntes: 250, resultado: 200,
      margemConsumida: 0.2, acosEquilibrio: 0.25, semaforo: 'dentro', motivo: null, fonteCusto: 'real' },
    { ...metr, codigoPai: 'B', nome: 'Fam B', grupos: 1, custoCompartilhado: 0, custo: 30, vendasDiretas: 0,
      vendasTotais: 0, roas: 0, roasDireto: 0, acos: null, acosDireto: null, lucroAntes: 0, resultado: -30,
      margemConsumida: null, acosEquilibrio: null, semaforo: null, motivo: 'sem_vendas', fonteCusto: null },
  ],
  compartilhados: [{ id: 9, custo: 20, familias: ['A', 'B'], semCodigo: 0 }],
};
const montar = (
  painel: PainelAds | null = PAINEL,
  extra: Partial<RetornoAdsPainel> = {},
) => {
  const retorno: RetornoAdsPainel = {
    painel,
    janela: { desde: '2026-09-04', ate: '2026-10-03' },
    situacaoPeriodo: 'pronto',
    historicoDesde: '2026-01-01T03:00:00.000Z',
    ultimoOkEm: '2026-10-04T14:17:00Z',
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };

  hook.mockReturnValue(retorno);
  return render(<MemoryRouter><Ads /></MemoryRouter>);
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  hook.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('Ads', () => {
  it('resumo da conta com as 3 parcelas da despesa e o resultado', () => {
    montar();
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByText('Resultado após Ads')).toBeInTheDocument();
    fireEvent.click(resumo.getByRole('button', { name: 'Composição e indicadores' }));
    expect(resumo.getByText('Gasto de Ads não identificado')).toBeInTheDocument();
    expect(screen.getByText(/não é o lucro causado pelo Ads/)).toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s?200,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Despesa informada pela API de Ads/)).toBeInTheDocument();
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
  it('conta indisponível mantém o ranking', () => {
    montar({ ...PAINEL, conta: null, contaMotivo: 'cobertura' });
    expect(screen.getByText(/Total da conta indisponível/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
  });
  it('trocar o período chama o hook com o preset estruturado', () => {
    localStorage.setItem('ads-painel-dias', '30');
    montar();

    expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 30 });

    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));

    expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 7 });
  });
  it('família com gasto compartilhado: resultado indisponível com o motivo', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], custoCompartilhado: 20, resultado: null, semaforo: null, motivo: 'compartilhado' }] });
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/gasto compartilhado com outra família/i)).toBeInTheDocument();
  });
  it('semáforo em validação: mostra o ACOS de equilíbrio sem verde/vermelho', () => {
    montar({ ...PAINEL, semaforoLiberado: false, familias: [{ ...PAINEL.familias[0], semaforo: null }] });
    expect(screen.getByText(/semáforo em validação/i)).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Fam A/ })).queryByText(/dentro/i)).not.toBeInTheDocument();
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
    expect(resumo.queryByText('Em famílias')).not.toBeInTheDocument();

    fireEvent.click(resumo.getByRole('button', { name: 'Composição e indicadores' }));

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
  });

  it.each(['parcial', 'estimado'] as const)(
    'mantém custo %s junto ao resultado com composição fechada',
    fonteCusto => {
      montar({ ...PAINEL, conta: { ...PAINEL.conta!, fonteCusto } });

      const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
      const resultado = within(resumo.getByRole('group', { name: 'Resultado após Ads' }));

      expect(resultado.getByText(`custo ${fonteCusto}`)).toBeVisible();
      expect(resumo.getByRole('button', { name: 'Composição e indicadores' }))
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

    expect(resumo.getByText('provisório — 14 dias com atribuição em aberto'))
      .toBeVisible();
    expect(screen.getByText(/não fecha com o total da conta/)).toBeVisible();
    expect(resumo.getByRole('button', { name: 'Composição e indicadores' }))
      .toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(resumo.getByRole('button', { name: 'Composição e indicadores' }));

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
    expect(ponte).toHaveTextContent(/R\$\s*200,00/);
  });

  it.each([7, 30, 90] as const)('preserva a preferência existente de %i dias', dias => {
    localStorage.setItem('ads-painel-dias', String(dias));
    montar();
    expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias });
  });

  it.each([null, '', '31', '0', '030', 'range', '{"tipo":"mes_atual"}'])(
    'usa o padrão para preferência inválida %s',
    valor => {
      if (valor !== null) localStorage.setItem('ads-painel-dias', valor);
      montar();
      expect(hook).toHaveBeenLastCalledWith(PERIODO_PADRAO_ADS);
    },
  );

  it('salva e restaura mês atual na chave existente', () => {
    const primeira = montar();

    fireEvent.click(screen.getByRole('button', { name: 'Mês atual' }));

    expect(localStorage.getItem('ads-painel-dias')).toBe('mes_atual');
    expect(hook).toHaveBeenLastCalledWith({ tipo: 'mes_atual' });

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

    expect(hook).toHaveBeenLastCalledWith(PERIODO_PADRAO_ADS);

    fireEvent.click(screen.getByRole('button', { name: 'Mês atual' }));

    expect(hook).toHaveBeenLastCalledWith({ tipo: 'mes_atual' });
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

    expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 30 });
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
        .toHaveAttribute('href', '/canais');
      expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
    },
  );

  it('erro oferece uma nova consulta', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar(null, { isError: true, refetch });

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('erro do sync mostra o alerta, não o skeleton', () => {
    montar(null, { janela: null, situacaoPeriodo: 'carregando', isError: true, ultimoOkEm: null });

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar o painel de Ads.');
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

    expect(screen.getByText('Nenhum gasto de Ads no período')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver últimos 90 dias' }));

    expect(hook).toHaveBeenLastCalledWith({ tipo: 'preset', dias: 90 });
  });

  it('sem_ads com 90 dias selecionado não repete a ação', () => {
    localStorage.setItem('ads-painel-dias', '90');
    montar({ ...PAINEL, estado: 'sem_ads', conta: null, familias: [], compartilhados: [] });

    expect(screen.getByText('Nenhum gasto de Ads no período')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ver últimos 90 dias' })).not.toBeInTheDocument();
  });

  it.each(['sem_coleta', 'coletando'] as const)('%s permite verificar novamente', estado => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    montar({ ...PAINEL, estado, conta: null, familias: [], compartilhados: [] }, { refetch });

    fireEvent.click(screen.getByRole('button', { name: 'Verificar novamente' }));

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Resultado após Ads')).not.toBeInTheDocument();
  });

  it('compartilhado e não identificado: valor na coluna Gasto', () => {
    montar();
    for (const nome of [/Compartilhado entre famílias/, /Gasto de Ads não identificado/]) {
      const celulas = within(screen.getByRole('row', { name: nome })).getAllByRole('cell');
      expect(celulas[0]).not.toHaveAttribute('colspan');
      expect(celulas[1]).toHaveTextContent(/R\$/);
    }
    const cab = screen.getAllByRole('columnheader');
    expect(cab[1]).toHaveTextContent('Gasto');
  });
  it('ordem total / direto em toda a tela', () => {
    montar();
    expect(screen.queryByText(/direta? \/ total/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/ROAS \(total \/ direto\)/).length).toBeGreaterThan(1);
  });
  it('sem família com gasto: mensagem em vez de tabela vazia', () => {
    montar({ ...PAINEL, conta: null, contaMotivo: 'cobertura', familias: [], compartilhados: [] });
    expect(screen.getAllByText('Nenhum gasto de Ads por família no período.').length).toBeGreaterThan(0);
  });
  it('grupo sem família (só anúncio sem código): rótulo "sem código identificado"', () => {
    montar({ ...PAINEL, compartilhados: [{ id: 7, custo: 2.02, familias: [], semCodigo: 1 }] });
    fireEvent.click(screen.getAllByRole('button', { name: /Compartilhado|sem código/ })[0]);
    expect(screen.getAllByText(/Grupo 7: sem código identificado/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/sem família \+/)).not.toBeInTheDocument();
  });
  it('motivo histórico com a data da 1ª venda', () => {
    montar({ ...PAINEL, familias: [{ ...PAINEL.familias[0], lucroAntes: null, resultado: null, motivo: 'historico' }] },
      { historicoDesde: '2026-08-03T15:00:00.000Z' });
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/antes do histórico de vendas \(desde 03\/08\/2026\)/)).toBeInTheDocument();
  });
});
