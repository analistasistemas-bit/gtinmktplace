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

  it('compartilhado e não identificado ficam em Gastos associados, fora das famílias', () => {
    montar();
    const associados = within(screen.getByRole('region', { name: 'Gastos associados' }));
    expect(associados.getByRole('button', { name: /Compartilhado entre famílias/ })).toBeInTheDocument();
    expect(associados.getByText(/R\$\s*20,00/)).toBeInTheDocument();
    expect(associados.getByText('Gasto de Ads não identificado')).toBeInTheDocument();
    expect(associados.getByText(/R\$\s*30,00/)).toBeInTheDocument();
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    expect(tabela.queryByRole('row', { name: /Compartilhado|não identificado/ })).not.toBeInTheDocument();
    expect(tabela.getAllByRole('columnheader')[1]).toHaveTextContent('Gasto');
  });
  it('ordem total / direto em toda a tela', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Composição e indicadores' }));
    fireEvent.click(within(screen.getByRole('row', { name: /Fam A/ })).getByRole('button', { name: 'Ver detalhes de Fam A' }));
    expect(screen.queryByText(/direta? \/ total/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/ROAS \(total \/ direto\)/).length).toBeGreaterThan(1);
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

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Em atenção' }));

    expect(tabela.queryByRole('row', { name: /Fam A/ })).not.toBeInTheDocument();
    expect(tabela.getByRole('row', { name: /Fam B/ })).toBeInTheDocument();
    expect(associados.textContent).toBe(antes);
    expect(screen.getByRole('button', { name: 'Remover filtro Em atenção' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('zero em atenção mostra frase sem botão de atenção', () => {
    montar();

    expect(screen.queryByRole('button', { name: /Filtrar por Em atenção/ }))
      .not.toBeInTheDocument();
    expect(screen.getByText(
      'Nenhuma família avaliável acima do equilíbrio. Há famílias sem referência.',
    )).toBeVisible();
  });

  it('zero em atenção com todas avaliáveis tem a frase própria', () => {
    montar({ ...PAINEL, familias: [PAINEL.familias[0]] });

    expect(screen.getByText('Nenhuma família acima do equilíbrio neste período.')).toBeVisible();
    // Dentro e Sem referência ficam sempre visíveis, mesmo com zero (§2.3); só Em atenção some.
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
    expect(linha.getByText('Acima do equilíbrio')).toBeVisible();
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

    fireEvent.click(screen.getByRole('button', { name: 'Filtrar por Em atenção' }));
    fireEvent.click(within(screen.getByRole('row', { name: /Fam B/ }))
      .getByRole('button', { name: 'Ver detalhes de Fam B' }));

    // Refetch da mesma janela: filtro e detalhe permanecem.
    hook.mockReturnValue({ ...ultimo(), isFetching: true });
    view.rerender(<MemoryRouter><Ads /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Remover filtro Em atenção' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('table', { name: 'Famílias por gasto' }))
      .getByRole('button', { name: 'Ver detalhes de Fam B' })).toHaveAttribute('aria-expanded', 'true');

    // Troca de período: volta a todas, detalhes fechados.
    hook.mockReturnValue({ ...ultimo(), isFetching: false, janela: { desde: '2026-09-27', ate: '2026-10-03' } });
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(screen.queryByRole('button', { name: 'Remover filtro Em atenção' })).not.toBeInTheDocument();
    const tabela = within(screen.getByRole('table', { name: 'Famílias por gasto' }));
    expect(tabela.getByRole('row', { name: /Fam A/ })).toBeInTheDocument();
    expect(tabela.getByRole('button', { name: 'Ver detalhes de Fam B' })).toHaveAttribute('aria-expanded', 'false');
  });
});
