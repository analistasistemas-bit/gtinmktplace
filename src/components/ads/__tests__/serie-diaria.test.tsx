import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiaAdsMetricas, MetricaBrutaAds, ValorAds } from '../../../../supabase/functions/_shared/ads/metricas';
import { fmtBRL } from '@/lib/formato';
import { SerieDiaria, pontosDiarios, textoValor } from '../serie-diaria';

// Em jsdom o ResponsiveContainer fica 0x0 e não desenha nada: tamanho fixo para o SVG existir.
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 280 } as never),
}));

const dia = (d: string, m: Partial<Record<MetricaBrutaAds, number | null | ValorAds>>): DiaAdsMetricas => ({
  dia: d,
  metricas: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === null ? { valor: null, motivo: 'nao_retornada' } : typeof v === 'object' ? v : { valor: v, motivo: null }])),
});

const JANELA = { desde: '2026-10-01', ate: '2026-10-04' };
const SERIE = [
  dia('2026-10-01', { cost: 10, total_amount: 50, advertising_items_quantity: 2, units_quantity: 3, organic_items_quantity: 5 }),
  // 02/10 ausente: lacuna, nunca zero.
  dia('2026-10-03', { cost: 0, total_amount: 0, advertising_items_quantity: 0, units_quantity: 0, organic_items_quantity: 4 }),
  dia('2026-10-04', { cost: 20, total_amount: 30, advertising_items_quantity: 1, units_quantity: 4, organic_items_quantity: null }),
];

describe('pontosDiarios', () => {
  it('dia ausente e métrica ausente viram null, nunca zero', () => {
    const p = pontosDiarios(SERIE, JANELA, undefined);
    expect(p.map((x) => x.dia)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(p[1]).toMatchObject({ atribuidas: null, outras: null, cost: null, receita: null, roas: null });
    expect(p[3].outras).toBeNull();
  });

  it('atribuídas usam units_quantity e outras usam organic_items_quantity', () => {
    const p = pontosDiarios(SERIE, JANELA, undefined);
    expect(p.map((x) => x.atribuidas)).toEqual([3, null, 0, 4]);
    expect(p[0].outras).toBe(5);
  });

  it('ROAS = receita / investimento do dia; cost 0 deixa lacuna', () => {
    const p = pontosDiarios(SERIE, JANELA, undefined);
    expect(p[0].roas).toBe(5);
    expect(p[2].roas).toBeNull();
    expect(p[3].roas).toBe(1.5);
  });

  it('marca os dias provisórios a partir da data informada', () => {
    const p = pontosDiarios(SERIE, JANELA, '2026-10-03');
    expect(p.map((x) => x.provisorio)).toEqual([false, false, true, true]);
  });
});

describe('SerieDiaria', () => {
  it('visão padrão: vendas atribuídas, outras vendas e ROAS', () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} />);
    const legenda = screen.getByRole('list', { name: 'Legenda' });
    expect(within(legenda).getByText('Vendas atribuídas')).toBeInTheDocument();
    expect(within(legenda).getByText('Outras vendas')).toBeInTheDocument();
    expect(within(legenda).getByRole('button', { name: 'O que é Outras vendas' })).toBeInTheDocument(); // M4
    expect(within(legenda).getByText(/ROAS/)).toBeInTheDocument();
    expect(screen.getByText(/universo dos anúncios promovidos/i)).toBeInTheDocument();
  });

  it('tabela acessível reproduz os dias, com traço na lacuna', async () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver dados em tabela' }));
    const tabela = screen.getByRole('table');
    const linhas = within(tabela).getAllByRole('row');
    expect(linhas).toHaveLength(5);
    expect(within(linhas[2]).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(within(linhas[1]).getByText('5,0×')).toBeInTheDocument();
    expect(within(linhas[3]).queryByText('0,0×')).toBeNull();
  });

  it('descreve a faixa provisória', () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} provisorioDesde="2026-10-03" />);
    expect(screen.getByText(/atribuição ainda em aberto/i)).toBeInTheDocument();
  });

  it('troca para Investimento × Receita Ads', async () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} />);
    await userEvent.click(screen.getByRole('button', { name: 'Investimento × Receita Ads' }));
    const legenda = screen.getByRole('list', { name: 'Legenda' });
    expect(within(legenda).getByText('Investimento')).toBeInTheDocument();
    expect(within(legenda).getByText('Receita Ads')).toBeInTheDocument();
    expect(within(legenda).queryByText('Outras vendas')).toBeNull();
  });

  it('limite: sempre entre uma e duas séries visíveis', async () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} visaoInicial="valores" />);
    const legenda = () => within(screen.getByRole('list', { name: 'Legenda' })).getAllByRole('listitem');
    expect(legenda()).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Investimento', pressed: true }));
    expect(legenda()).toHaveLength(1);
    // A última série ligada não pode ser desligada.
    await userEvent.click(screen.getByRole('button', { name: 'Receita Ads', pressed: true }));
    expect(legenda()).toHaveLength(1);
  });

  it('sem nenhum dia na janela mostra estado vazio', () => {
    render(<SerieDiaria serie={[]} janela={JANELA} />);
    expect(screen.getByText(/nenhum dia com dados/i)).toBeInTheDocument();
  });

  it('desenha barras e a linha de ROAS interrompida na lacuna', () => {
    const { container } = render(<SerieDiaria serie={SERIE} janela={JANELA} />);
    // Barras com valor > 0 (atribuídas 01 e 04; outras 01 e 03); dia ausente/nulo não vira barra.
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(4);
    const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? '';
    // 01/10 e 04/10 têm ROAS; 02 (ausente) e 03 (cost 0) quebram o traço em dois segmentos.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(2);
  });

  it('tabela traz as datas e as células de cada dia', async () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver dados em tabela' }));
    const linhas = within(screen.getByRole('table')).getAllByRole('row');
    expect(linhas.map((l) => within(l).queryByRole('rowheader')?.textContent)).toEqual([undefined, '01/10', '02/10', '03/10', '04/10']);
    expect(within(linhas[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['3', '5', fmtBRL(10), fmtBRL(50), '5,0×']);
  });

  it('tabela explica o motivo de cada valor indisponível', async () => {
    const serie = [
      dia('2026-10-01', { cost: { valor: null, motivo: 'fora_da_retencao' }, total_amount: 5, units_quantity: { valor: null, motivo: 'sem_permissao' }, organic_items_quantity: 1 }),
    ];
    render(<SerieDiaria serie={serie} janela={{ desde: '2026-10-01', ate: '2026-10-02' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver dados em tabela' }));
    const linhas = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(linhas[1]).getAllByText('Período fora da retenção do ML.')[0]).toBeInTheDocument();
    expect(within(linhas[1]).getByText('Sem permissão para ler esta métrica.')).toBeInTheDocument();
    expect(within(linhas[2]).getAllByText('Sem retorno do ML neste dia.').length).toBeGreaterThan(0);
  });

  it('avisa quando o bloco está incompleto, com os motivos', () => {
    const serie = [dia('2026-10-01', { cost: { valor: null, motivo: 'fora_da_retencao' } })];
    render(<SerieDiaria serie={serie} janela={JANELA} completo={false} />);
    const aviso = screen.getByRole('status');
    expect(aviso).toHaveTextContent(/dados incompletos/i);
    expect(aviso).toHaveTextContent('Período fora da retenção do ML.');
  });

  it('não avisa quando o bloco está completo', () => {
    render(<SerieDiaria serie={SERIE} janela={JANELA} completo />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('tooltip chama quantidade de vendas, não de unidades', () => {
    expect(textoValor('vendas', 'Vendas atribuídas', 3)).toBe('3 unidades');
    expect(textoValor('vendas', 'Outras vendas', 1)).toBe('1 venda');
    expect(textoValor('vendas', 'ROAS', 2.5)).toBe('2,5×');
    expect(textoValor('valores', 'Investimento', 10)).toBe(fmtBRL(10));
  });
});
