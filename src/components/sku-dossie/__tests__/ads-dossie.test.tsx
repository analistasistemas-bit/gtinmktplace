import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PainelAds } from '../ads-dossie';
import { diaBRT, intervalosBRT } from '@/lib/calendario-brt';
import type { AdsDossie as DadosAds } from '@/lib/sku-ads';

const AGORA = new Date('2026-09-27T15:00:00Z');
const IVS = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-28T02:59:59.999Z', 'semana', AGORA);
const dia = (d: string) => ({
  inicio: `2026-09-${d}T03:00:00.000Z`, fim: `2026-09-${Number(d) + 1}T03:00:00.000Z`, rotulo: `${d}/09`, incompleto: false, inicioParcial: false,
});
const base: DadosAds = {
  estado: 'ok', alcance: 'sku',
  totais: { custo: 100, cliques: 50, impressoes: 900, vendasDiretas: 100, vendasIndiretas: 90, vendasTotais: 190,
    unidadesDiretas: 2, unidades: 3, cpc: 2, roas: 1.9, acos: 100 / 190 },
  lucroAposAds: 400, fonteLucro: 'real', motivoSemLucro: null, naoIdentificadoPct: null, naoIdentificadoMotivo: null, compartilhadoCom: { codigos: [], semVinculo: 0 },
  historicoDesde: '2026-01-01T03:00:00.000Z', fimDia: diaBRT(Date.now() - 86_400_000), // ontem: os textos dizem "ontem"
  serie: IVS.map((intervalo, i) => ({ intervalo, custo: i ? 90 : 10, vendas: i ? 90 : 100, aberto: i === 1 })),
  serieDiaria: ['14', '15'].map((d) => ({ intervalo: dia(d), custo: 5, vendas: 20, aberto: true })),
  grupos: [{ id: 3000001, tipo: 'FAMILY', status: 'ACTIVE', campanhaId: 2000001, custo: 100, exclusivo: true, mlbs: ['MLB1'], codigos: ['A'], semVinculo: 0 }],
  coberturaDesde: '2026-06-29', ultimoOkEm: '2026-09-27T14:20:00Z', diasAbertos: 12, erro: null,
};
const vazio = (estado: DadosAds['estado']): DadosAds => ({
  ...base, estado, alcance: 'indisponivel', totais: null, lucroAposAds: null, fonteLucro: null, serie: [], serieDiaria: [], grupos: [], diasAbertos: 0,
});
const renderiza = (ads: DadosAds | null, familia = false) =>
  render(<PainelAds ads={ads} familia={familia} passo="semana" onPasso={vi.fn()} onTentar={vi.fn()} />);
const detalhe = () => screen.getByTestId('detalhe-ads');

describe('PainelAds', () => {
  it('KPIs por Σ e lucro após Ads com o rótulo do período', () => {
    renderiza(base);
    expect(screen.getByText('Despesa de Ads do período')).toBeInTheDocument();
    expect(screen.getByText('1,9×')).toBeInTheDocument();
    expect(screen.getByText('Lucro após Ads')).toBeInTheDocument();
    expect(screen.getByText('Vendas atribuídas · 12 dias com atribuição em aberto')).toBeInTheDocument();
    expect(screen.getByText(/lucro do período até ontem − despesa de Ads até ontem/)).toBeInTheDocument();
  });

  it('"Dia" troca para a série diária (rótulo dd/mm) sem mexer no Passo do dossiê', () => {
    const onPasso = vi.fn();
    render(<PainelAds ads={base} familia={false} passo="semana" onPasso={onPasso} onTentar={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    expect(screen.getByRole('heading', { name: 'Ads por dia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Série diária de 14\/09 a 15\/09\./)).toBeInTheDocument();
    expect(onPasso).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mês' }));
    expect(onPasso).toHaveBeenCalledWith('mes');
  });

  it('alcance antes do estado: alvo sem MLB (ok + indisponível, totais null) não é "sem Ads" nem skeleton', () => {
    renderiza({ ...vazio('ok') });
    expect(screen.getByText(/Nenhum anúncio do Mercado Livre vinculado a este código/)).toBeInTheDocument();
    expect(screen.queryByText('Despesa de Ads do período')).toBeNull();
    expect(screen.queryByText(/Nenhum gasto de Ads/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dia' })).toBeNull();
  });

  it('parcial: carga inicial em andamento, grupos listados e NENHUM número de despesa', () => {
    renderiza({
      ...base, estado: 'parcial', totais: null, lucroAposAds: null,
      serie: base.serie.map((p) => ({ ...p, custo: null, vendas: null, aberto: false })),
      serieDiaria: base.serieDiaria.map((p) => ({ ...p, custo: null, vendas: null, aberto: false })),
      grupos: base.grupos.map((g) => ({ ...g, custo: null })),
    });
    expect(screen.getByText(/Carga inicial dos últimos 90 dias em curso/)).toBeInTheDocument();
    expect(screen.queryByText('Despesa de Ads do período')).toBeNull();
    expect(screen.queryByText(/R\$/)).toBeNull();
    expect(screen.getByText('em carga')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ads' })).toBeInTheDocument();
  });

  it('desatualizado e sem_ads', () => {
    const r2 = renderiza({ ...base, estado: 'desatualizado' });
    expect(screen.getByText(/Última coleta ok/)).toBeInTheDocument();
    r2.unmount();
    renderiza({ ...base, estado: 'sem_ads', totais: { ...base.totais!, custo: 0, roas: null } });
    expect(screen.getByText(/Nenhum gasto de Ads nos anúncios vinculados a este SKU/)).toBeInTheDocument();
  });

  it('gasto da conta sem família identificada: mostra o lucro e o % (acima de 0,5%); abaixo disso, nada', () => {
    const r = renderiza({ ...base, naoIdentificadoPct: 0.05 });
    expect(screen.getAllByText(/5,0% do gasto de Ads da conta neste período não tem família identificada/).length).toBeGreaterThan(0);
    expect(screen.getByText('R$ 400,00')).toBeInTheDocument();
    r.unmount();
    renderiza({ ...base, naoIdentificadoPct: 0.004 });
    expect(screen.queryByText(/não tem família identificada/)).toBeNull();
  });

  it('lucro 0 com despesa 30: Lucro após Ads −R$ 30,00 em vermelho', () => {
    renderiza({ ...base, totais: { ...base.totais!, custo: 30 }, lucroAposAds: -30 });
    const v = screen.getByText('-R$ 30,00');
    expect(v).toHaveClass('text-danger');
  });

  it('% não identificado indisponível: a tela diz o motivo (período acima de 1 ano)', () => {
    renderiza({ ...base, naoIdentificadoMotivo: 'periodo_longo' });
    expect(screen.getAllByText(/aviso indisponível para períodos acima de 1 ano/).length).toBeGreaterThan(0);
  });

  it('status do grupo EMPTY traduzido para "vazio" (item 3 da correção final: o mais comum não tinha tradução)', () => {
    renderiza({ ...base, grupos: [{ ...base.grupos[0], status: 'EMPTY' }] });
    expect(screen.getByText('vazio')).toBeInTheDocument();
  });

  it('gasto compartilhado: lucro após Ads indisponível com o motivo', () => {
    renderiza({ ...base, alcance: 'anuncio', lucroAposAds: null, motivoSemLucro: 'compartilhado', compartilhadoCom: { codigos: ['B'], semVinculo: 1 } });
    expect(screen.getAllByText(/gasto compartilhado com 1 código de fora e 1 anúncio sem vínculo/).length).toBeGreaterThan(0);
    expect(screen.getByText('Gasto dos grupos compartilhados: não é só deste SKU')).toBeInTheDocument();
  });

  it('histórico: mesmo texto do painel, com a data da 1ª venda da org', () => {
    renderiza({ ...base, lucroAposAds: null, motivoSemLucro: 'historico', historicoDesde: '2026-08-03T15:00:00Z' });
    expect(screen.getAllByText(/período antes do histórico de vendas \(desde 03\/08\/2026\)/).length).toBeGreaterThan(0);
  });

  it('% não identificado com 1 casa decimal, igual ao painel', () => {
    renderiza({ ...base, naoIdentificadoPct: 0.074 });
    expect(screen.getAllByText(/7,4% do gasto de Ads da conta/).length).toBeGreaterThan(0);
  });

  it('fim do período antes de ontem (coleta do dia pendente): textos dizem a data, não "ontem"', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-27T11:00:00Z') });
    renderiza({ ...base, fimDia: '2026-09-25' });
    expect(screen.getByText(/lucro do período até 25\/09 − despesa de Ads até 25\/09/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('cobertura: motivo próprio', () => {
    renderiza({ ...base, lucroAposAds: null, motivoSemLucro: 'cobertura' });
    expect(screen.getAllByText(/a coleta de Ads não cobre o período inteiro/).length).toBeGreaterThan(0);
  });

  it('foco inicial no último intervalo completo; o detalhe separa zero medido de sem dado e marca atribuição em aberto', () => {
    renderiza({ ...base, serie: [
      { intervalo: IVS[0], custo: 0, vendas: 0, aberto: false },
      { intervalo: IVS[1], custo: null, vendas: null, aberto: false },
    ] });
    // IVS[1] é o intervalo corrente (parcial): a entrada é IVS[0].
    expect(within(detalhe()).getByText('Semana de 14/09')).toBeInTheDocument();
    expect(within(detalhe()).getAllByText('R$ 0,00').length).toBe(2);
    fireEvent.keyDown(screen.getByRole('button', { name: /^Semana de 14\/09/ }), { key: 'ArrowRight' });
    expect(within(detalhe()).getByText(/Semana de 21\/09/)).toBeInTheDocument();
    expect(within(detalhe()).getAllByText('sem dado').length).toBeGreaterThan(0);
    expect(within(detalhe()).queryByText('R$ 0,00')).toBeNull();
  });

  it('atribuição em aberto: provisória no detalhe e legenda só com o que existe', () => {
    renderiza(base);
    fireEvent.click(screen.getByRole('button', { name: /^Semana de 21\/09/ }));
    expect(within(detalhe()).getByText('em aberto (provisória)')).toBeInTheDocument();
    expect(screen.getByText('Atribuição em aberto')).toBeInTheDocument();
    expect(screen.queryByText('Sem dado')).toBeNull();
  });

  it('trocar para "Dia" reinicia o foco no último dia', () => {
    renderiza(base);
    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    expect(within(detalhe()).getByText('15/09')).toBeInTheDocument();
  });

  it('403: explica permissão de Publicidade ou conexão recusada, sem falar em token expirado', () => {
    renderiza({ ...vazio('sem_permissao') });
    expect(screen.getByText(/sem permissão de Publicidade ou conexão recusada/)).toBeInTheDocument();
    expect(screen.queryByText(/expirad/)).toBeNull();
  });

  it('sem coleta, sem anunciante, erro e carregando', () => {
    const onTentar = vi.fn();
    const r1 = renderiza({ ...vazio('sem_coleta') });
    expect(screen.getByText(/A coleta de Ads começa após a ativação/)).toBeInTheDocument();
    r1.unmount();
    const r2 = renderiza({ ...vazio('sem_advertiser') });
    expect(screen.getByText(/Meu perfil → Publicidade/)).toBeInTheDocument();
    r2.unmount();
    const r3 = render(<PainelAds ads={vazio('erro')} familia={false} passo="semana" onPasso={vi.fn()} onTentar={onTentar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onTentar).toHaveBeenCalled();
    r3.unmount();
    const r4 = renderiza({ ...vazio('carregando') });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    r4.unmount();
    renderiza(null);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('lucro com custo parcial ou estimado: número continua, com a marca no fato, no rodapé e no resumo', () => {
    const r1 = renderiza({ ...base, fonteLucro: 'parcial' });
    expect(screen.getByText('· custo parcial')).toHaveClass('block');
    expect(screen.getByText('R$ 400,00')).toBeInTheDocument();
    expect(screen.getByText(/lucro do período até ontem \(parcial: só os itens com custo\) − despesa de Ads até ontem/)).toBeInTheDocument();
    expect(screen.getByText(/Lucro após Ads R\$\s400,00, custo parcial\./)).toBeInTheDocument();
    r1.unmount();
    renderiza({ ...base, fonteLucro: 'estimado' });
    expect(screen.getByText('· custo estimado')).toBeInTheDocument();
    expect(screen.getByText(/lucro do período até ontem \(com custo estimado do cadastro\) − despesa/)).toBeInTheDocument();
    expect(screen.getByText(/Lucro após Ads R\$\s400,00, custo estimado\./)).toBeInTheDocument();
  });

  it('lucro real não leva marca; lucro negativo em vermelho', () => {
    const r1 = renderiza(base);
    expect(screen.queryByText(/· custo/)).toBeNull();
    r1.unmount();
    renderiza({ ...base, lucroAposAds: -50 });
    expect(screen.getByText('-R$ 50,00')).toHaveClass('text-danger');
  });

  it('sem_ads: aviso, KPIs e grupos; sem gráfico, régua, detalhe nem Dia/Semana/Mês', () => {
    renderiza({ ...base, estado: 'sem_ads', totais: { ...base.totais!, custo: 0, roas: null },
      serie: base.serie.map((p) => ({ ...p, custo: 0, vendas: 0, aberto: false })) });
    expect(screen.getByText('Despesa de Ads do período')).toBeInTheDocument();
    expect(screen.getByText('Grupos de anúncios · vínculo atual')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Intervalos dos Ads' })).toBeNull();
    expect(screen.queryByTestId('detalhe-ads')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dia' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ads' })).toBeInTheDocument();
    expect(screen.getByText('Vendas atribuídas')).toBeInTheDocument();
    expect(screen.queryByText(/com atribuição em aberto/)).toBeNull();
  });

  it('pill do grupo compartilhado conta os códigos de fora (coerente com o motivo) e os MLBs têm title', () => {
    renderiza({ ...base, alcance: 'anuncio', lucroAposAds: null, fonteLucro: null, motivoSemLucro: 'compartilhado',
      compartilhadoCom: { codigos: ['B'], semVinculo: 1 },
      grupos: [{ ...base.grupos[0], exclusivo: false, codigos: ['A', 'B'], semVinculo: 1, mlbs: ['MLB1', 'MLB2', 'MLB3'] }] });
    expect(screen.getByText('compartilhado · +1 código de fora + 1 sem vínculo')).toBeInTheDocument();
    expect(screen.getByTitle('MLB1, MLB2, MLB3')).toBeInTheDocument();
  });

  it('legenda "Sem dado" só quando há intervalo sem dado', () => {
    const r1 = renderiza(base);
    expect(screen.queryByText('Sem dado')).toBeNull();
    r1.unmount();
    renderiza({ ...base, serie: [{ ...base.serie[0], custo: null, vendas: null, aberto: false }, base.serie[1]] });
    expect(screen.getByText('Sem dado')).toBeInTheDocument();
  });

  it('régua: Home e End vão ao primeiro e ao último intervalo', () => {
    renderiza(base);
    const primeiro = screen.getByRole('button', { name: /^Semana de 14\/09/ });
    fireEvent.keyDown(primeiro, { key: 'End' });
    expect(within(detalhe()).getByText(/Semana de 21\/09/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Semana de 21\/09/ }), { key: 'Home' });
    expect(within(detalhe()).getByText('Semana de 14/09')).toBeInTheDocument();
  });

  it('série diária: coluna mínima de 24 px (alvo de toque); semanal segue a do dossiê', () => {
    renderiza(base);
    expect(screen.getByTestId('ads-plot')).toHaveStyle({ minWidth: `${2 * 14 + 4}px` });
    fireEvent.click(screen.getByRole('button', { name: 'Dia' }));
    expect(screen.getByTestId('ads-plot')).toHaveStyle({ minWidth: `${2 * 24 + 4}px` });
  });
});
