import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PainelAds } from '@/lib/ads-painel';

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
const montar = (painel: PainelAds | null = PAINEL) => {
  hook.mockReturnValue({ painel, janela: { desde: '2026-09-04', ate: '2026-10-03' }, isLoading: false, isError: false, refetch: vi.fn() });
  return render(<MemoryRouter><Ads /></MemoryRouter>);
};
beforeEach(() => hook.mockReset());

describe('Ads', () => {
  it('resumo da conta com as 3 parcelas da despesa e o resultado', () => {
    montar();
    const resumo = within(screen.getByRole('region', { name: 'Resumo da conta' }));
    expect(resumo.getByText('Resultado após Ads')).toBeInTheDocument();
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
  it('trocar o período chama o hook com os dias', () => {
    montar();
    expect(hook).toHaveBeenLastCalledWith(30);
    fireEvent.click(screen.getByRole('button', { name: '7 dias' }));
    expect(hook).toHaveBeenLastCalledWith(7);
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
    hook.mockReturnValue({ painel: { ...PAINEL, conta: { ...PAINEL.conta!, lucroAntes: null, resultado: null },
      familias: [{ ...PAINEL.familias[0], lucroAntes: null, resultado: null, motivo: 'historico' }] },
      janela: { desde: '2026-09-04', ate: '2026-10-03' }, historicoDesde: '2026-09-10T15:00:00.000Z',
      isLoading: false, isError: false, refetch: vi.fn() });
    render(<MemoryRouter><Ads /></MemoryRouter>);
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
  it('período sempre visível com a data final', () => {
    montar();
    expect(screen.getByText(/04\/09 – 03\/10/)).toBeInTheDocument();
    expect(screen.getByText(/até 03\/10/)).toBeInTheDocument();
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
    hook.mockReturnValue({ painel: { ...PAINEL, familias: [{ ...PAINEL.familias[0], lucroAntes: null, resultado: null, motivo: 'historico' }] },
      janela: { desde: '2026-09-04', ate: '2026-10-03' }, historicoDesde: '2026-08-03T15:00:00.000Z',
      isLoading: false, isError: false, refetch: vi.fn() });
    render(<MemoryRouter><Ads /></MemoryRouter>);
    expect(within(screen.getByRole('row', { name: /Fam A/ })).getByText(/antes do histórico de vendas \(desde 03\/08\/2026\)/)).toBeInTheDocument();
  });
});
