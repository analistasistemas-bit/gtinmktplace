import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { escolherNoSelect } from '@/test/select';
import type {
  BlocoAdsMetricas, CampanhaPeriodoAds, MetricaBrutaAds, ValorAds,
} from '../../../../supabase/functions/_shared/ads/metricas';
import { TabelaCampanhas } from '../campanhas/tabela-campanhas';
import { FaixaKpis } from '../faixa-kpis';

const ok = (valor: number): ValorAds => ({ valor, motivo: null });
const bloco = (m: Partial<Record<MetricaBrutaAds, ValorAds>>): BlocoAdsMetricas => ({
  janela: { desde: '2026-10-01', ate: '2026-10-07' }, resumo: m, serie: [], completo: true, lidoEm: '2026-10-08T10:00:00Z',
});
const camp = (
  id: number, nome: string, statusAtual: string,
  atual: Partial<Record<MetricaBrutaAds, ValorAds>>, anterior: Partial<Record<MetricaBrutaAds, ValorAds>> | null = null,
): CampanhaPeriodoAds => ({ id, nome, statusAtual, atual: bloco(atual), anterior: anterior && bloco(anterior) });

const m = (cost: number, receita: number, vendas: number, prints = 1000, clicks = 50): Partial<Record<MetricaBrutaAds, ValorAds>> => ({
  cost: ok(cost), total_amount: ok(receita), advertising_items_quantity: ok(vendas), prints: ok(prints), clicks: ok(clicks), cvr: ok(4),
});

const CAMPANHAS = [
  camp(1, 'Verão ativa', 'active', m(100, 800, 10), m(100, 400, 5)),
  camp(2, 'Inverno pausada', 'paused', m(300, 600, 4)),
  camp(3, 'Antiga removida', 'deleted', m(50, 500, 6)),
];
const DISP = { estado: 'disponivel', motivo: null } as const;
const tabela = () => screen.getByRole('table');
const nomesNaTabela = () => within(tabela()).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent ?? '');

describe('TabelaCampanhas', () => {
  it('campanha histórica (deleted) devolvida pelo ML aparece com estado atual', () => {
    render(<TabelaCampanhas campanhas={CAMPANHAS} comparacao={DISP} onAbrir={vi.fn()} />);
    const linha = within(tabela()).getByText('Antiga removida').closest('tr')!;
    expect(within(linha).getByText('Removida')).toBeTruthy();
    expect(within(linha).getByText(/R\$\s*50,00/)).toBeTruthy();
  });

  it('filtrar, buscar e ordenar mudam só as linhas: resumo da conta e payload ficam intactos', async () => {
    const user = userEvent.setup();
    // Resumo da conta (todas as campanhas): totais diferentes de qualquer subconjunto filtrado.
    const conta: Record<string, ValorAds> = { investimento: ok(450), vendas: ok(20), receita: ok(1900), roas: ok(4.22), acos: ok(0.2368) };
    const original = structuredClone(CAMPANHAS);
    const ordemOriginal = CAMPANHAS.map((c) => c.id);
    render(
      <>
        <div data-testid="resumo"><FaixaKpis atual={conta} anterior={null} comparacao="desligada" /></div>
        <TabelaCampanhas campanhas={CAMPANHAS} comparacao={DISP} onAbrir={vi.fn()} />
      </>,
    );
    const resumo = () => screen.getByTestId('resumo').textContent;
    const antes = resumo();
    expect(antes).toContain('450,00');
    expect(nomesNaTabela()).toHaveLength(3);

    await escolherNoSelect(user, 'Status', 'Pausada');
    expect(nomesNaTabela()).toEqual([expect.stringContaining('Inverno pausada')]);
    await user.type(screen.getByRole('searchbox', { name: /buscar campanha/i }), 'zzz');
    expect(screen.getByText(/nenhuma campanha encontrada/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ver todas' }));
    await user.click(within(tabela()).getByRole('button', { name: /Investimento/ }));

    expect(resumo()).toBe(antes);
    expect(CAMPANHAS).toEqual(original);
    expect(CAMPANHAS.map((c) => c.id)).toEqual(ordemOriginal);
    expect(within(tabela()).queryByText(/total/i)).toBeNull();
  });

  it('troca de visão Resultado/Eficiência muda as colunas', async () => {
    const user = userEvent.setup();
    render(<TabelaCampanhas campanhas={CAMPANHAS} comparacao={DISP} onAbrir={vi.fn()} />);
    expect(within(tabela()).getByRole('columnheader', { name: /ROAS/ })).toBeTruthy();
    expect(within(tabela()).queryByRole('columnheader', { name: /Cliques/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Eficiência' }));
    for (const c of ['Impressões', 'Cliques', 'CTR', 'CPC', 'Conversão']) {
      expect(within(tabela()).getByRole('columnheader', { name: new RegExp(c) })).toBeTruthy();
    }
    expect(within(tabela()).queryByRole('columnheader', { name: /ROAS/ })).toBeNull();
  });

  it('ordena por coluna com aria-sort e nulos no fim', async () => {
    const user = userEvent.setup();
    render(<TabelaCampanhas campanhas={[...CAMPANHAS, camp(4, 'Sem dados', 'active', {})]} comparacao={DISP} onAbrir={vi.fn()} />);
    const th = () => within(tabela()).getByRole('columnheader', { name: /Investimento/ });
    expect(th().getAttribute('aria-sort')).toBe('descending');
    expect(nomesNaTabela()[0]).toContain('Inverno');
    await user.click(within(th()).getByRole('button', { name: /Investimento/ }));
    expect(th().getAttribute('aria-sort')).toBe('ascending');
    const nomes = nomesNaTabela();
    expect(nomes[0]).toContain('Antiga');
    expect(nomes[3]).toContain('Sem dados');
  });

  it('métrica indisponível mostra travessão e o motivo dentro da célula', () => {
    const sem = camp(5, 'Campanha Alfa', 'active', { ...m(10, 50, 1), total_amount: { valor: null, motivo: 'fora_da_retencao' } });
    render(<TabelaCampanhas campanhas={[sem]} comparacao={DISP} onAbrir={vi.fn()} />);
    const linha = within(tabela()).getByText('Campanha Alfa').closest('tr')!;
    const colReceita = Array.from(tabela().querySelectorAll('th')).findIndex((h) => /Receita Ads/.test(h.textContent ?? ''));
    const celula = within(linha).getAllByRole('cell')[colReceita];
    expect(celula.textContent).toBe('—Período fora da retenção do ML.');
  });

  it('delta por célula: ACOS em queda é success; provisória fica neutra com selo', () => {
    const { rerender } = render(<TabelaCampanhas campanhas={[CAMPANHAS[0]]} comparacao={DISP} onAbrir={vi.fn()} />);
    const linha = () => within(tabela()).getByText('Verão ativa').closest('tr')!;
    const acos = linha().querySelector('[data-delta][data-direcao="down"]') as HTMLElement;
    expect(acos.getAttribute('data-tom')).toBe('success');
    rerender(<TabelaCampanhas campanhas={[CAMPANHAS[0]]} comparacao={{ estado: 'provisoria', motivo: null }} onAbrir={vi.fn()} />);
    expect(linha().querySelectorAll('[data-tom="success"],[data-tom="danger"]')).toHaveLength(0);
    expect(within(linha()).getAllByText('Provisória').length).toBeGreaterThan(0);
    rerender(<TabelaCampanhas campanhas={[CAMPANHAS[0]]} comparacao={{ estado: 'desligada', motivo: null }} onAbrir={vi.fn()} />);
    expect(linha().querySelector('[data-delta]')).toBeNull();
  });

  it('"Ver campanha" chama onAbrir com o id', async () => {
    const onAbrir = vi.fn();
    render(<TabelaCampanhas campanhas={CAMPANHAS} comparacao={DISP} onAbrir={onAbrir} />);
    await userEvent.setup().click(within(tabela()).getByRole('button', { name: 'Ver campanha Inverno pausada' }));
    expect(onAbrir).toHaveBeenCalledWith(2);
  });
});
